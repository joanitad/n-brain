import { type Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { nanoid } from "nanoid";
import { driver } from "./db";
import { parseVaultDirectory } from "./lib/vault-parser";
import { generateEmbeddings, buildEmbeddingText } from "./lib/embeddings";
import { queryGraph } from "./lib/query";
import { discoverBridges, runCommunityDetection, runLeiden, runCentrality, runPageRank, findShortestPath } from "./lib/discovery";
import unzipper from "unzipper";
import { execSync } from "child_process";

const upload = multer({ dest: os.tmpdir() });

function optionalUpload(req: any, res: any, next: any) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) {
    upload.single("vault")(req, res, next);
  } else {
    next();
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/vaults", async (_req, res) => {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (v:Vault)
         OPTIONAL MATCH (v)-[:CONTAINS]->(n:Note)
         WITH v.id AS id, v.name AS name, v.createdAt AS createdAt, count(n) AS noteCount
         RETURN id, name, noteCount
         ORDER BY createdAt DESC`,
      );
      res.json(result.records.map((r) => ({
        id: r.get("id"),
        name: r.get("name"),
        noteCount: (r.get("noteCount") as any)?.toNumber?.() ?? r.get("noteCount"),
      })));
    } finally {
      await session.close();
    }
  });

  app.post("/api/vaults/upload", optionalUpload, async (req: any, res) => {
    const vaultName = req.body.name || "Untitled Vault";
    const vaultId = nanoid();
    const session = driver.session();

    try {
      /* eslint-disable no-inner-declarations */
      let vaultPath: string;

      if (req.body.githubUrl) {
        const url = req.body.githubUrl;
        if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/.*)?$/.test(url)) {
          return res.status(400).json({ message: "Invalid GitHub URL" });
        }

        const treeMatch = url.match(/\/tree\/([^/]+)\/(.+)$/);
        const repoUrl = url.replace(/\/tree\/.*$/, "").replace(/\/$/, "") + ".git";
        const clonePath = path.join(os.tmpdir(), `vault-${vaultId}`);

        if (treeMatch) {
          const branch = treeMatch[1];
          const subdir = treeMatch[2];
          execSync(
            `git clone --depth 1 --filter=blob:none --sparse --branch ${branch} ${repoUrl} ${clonePath}`,
            { timeout: 60000, stdio: "pipe" },
          );
          execSync(`git sparse-checkout set ${subdir}`, {
            cwd: clonePath,
            timeout: 60000,
            stdio: "pipe",
          });
          vaultPath = path.join(clonePath, subdir);
        } else {
          execSync(`git clone --depth 1 ${repoUrl} ${clonePath}`, {
            timeout: 120000,
            stdio: "pipe",
          });
          vaultPath = clonePath;
        }
      } else if (req.body.path) {
        vaultPath = req.body.path;
        if (!fs.existsSync(vaultPath)) {
          return res.status(400).json({ message: "Vault path does not exist" });
        }
      } else if (req.file) {
        vaultPath = path.join(os.tmpdir(), `vault-${vaultId}`);
        await fs.createReadStream(req.file.path)
          .pipe(unzipper.Extract({ path: vaultPath }))
          .promise();
      } else {
        return res.status(400).json({ message: "Provide a vault ZIP file or path" });
      }

      const notes = await parseVaultDirectory(vaultPath);

      await session.run(
        `CREATE (v:Vault {id: $id, name: $name, noteCount: $noteCount, createdAt: datetime()})`,
        { id: vaultId, name: vaultName, noteCount: notes.length },
      );

      for (const note of notes) {
        await session.run(
          `MATCH (v:Vault {id: $vaultId})
           CREATE (v)-[:CONTAINS]->(n:Note {
             id: $id, title: $title, content: $content,
             contentPreview: $contentPreview, createdAt: datetime()
           })
           WITH n
           UNWIND $tags AS tagName
           MERGE (t:Tag {name: tagName})
           CREATE (n)-[:TAGGED]->(t)`,
          {
            vaultId,
            id: note.id,
            title: note.title,
            content: note.content,
            contentPreview: note.contentPreview,
            tags: note.tags,
          },
        );
      }

      // Resolve wikilinks to LINKS_TO relationships
      for (const note of notes) {
        if (note.outgoingLinks.length > 0) {
          await session.run(
            `MATCH (v:Vault {id: $vaultId})-[:CONTAINS]->(source:Note {id: $sourceId})
             MATCH (v)-[:CONTAINS]->(target:Note)
             WHERE target.title IN $links
             CREATE (source)-[:LINKS_TO]->(target)`,
            { vaultId, sourceId: note.id, links: note.outgoingLinks },
          );
        }
      }

      // Generate embeddings (local model, no API key needed)
      const texts = notes.map((n) => buildEmbeddingText(n.title, n.contentPreview, n.tags));
      const embeddings = await generateEmbeddings(texts);

      for (let i = 0; i < notes.length; i++) {
        await session.run(
          `MATCH (n:Note {id: $id}) SET n.embedding = $embedding`,
          { id: notes[i].id, embedding: embeddings[i] },
        );
      }

      await discoverBridges();

      res.json({ id: vaultId, name: vaultName, noteCount: notes.length });
    } catch (err: any) {
      console.error("Upload error:", err);
      res.status(500).json({ message: err.message || "Upload failed" });
    } finally {
      await session.close();
    }
  });

  app.delete("/api/vaults/:id", async (req, res) => {
    const session = driver.session();
    try {
      await session.run(
        `MATCH (v:Vault {id: $id})-[:CONTAINS]->(n:Note) DETACH DELETE n`,
        { id: req.params.id },
      );
      await session.run(
        `MATCH (v:Vault {id: $id}) DETACH DELETE v`,
        { id: req.params.id },
      );
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Delete error:", err);
      res.status(500).json({ message: err.message });
    } finally {
      await session.close();
    }
  });

  app.get("/api/feed", async (_req, res) => {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (n1:Note)-[b:BRIDGES]-(n2:Note)
         WHERE b.bridgeScore IS NOT NULL
         MATCH (v1:Vault)-[:CONTAINS]->(n1)
         MATCH (v2:Vault)-[:CONTAINS]->(n2)
         RETURN n1 { .id, .title, .contentPreview } AS noteA,
                v1.name AS vaultA,
                n2 { .id, .title, .contentPreview } AS noteB,
                v2.name AS vaultB,
                b.similarity AS similarity,
                b.bridgeScore AS bridgeScore,
                b.explanation AS explanation
         ORDER BY b.bridgeScore DESC
         LIMIT 50`,
      );
      res.json(
        result.records.map((r) => ({
          noteA: r.get("noteA"),
          vaultA: r.get("vaultA"),
          noteB: r.get("noteB"),
          vaultB: r.get("vaultB"),
          similarity: r.get("similarity"),
          bridgeScore: r.get("bridgeScore"),
          explanation: r.get("explanation"),
        })),
      );
    } finally {
      await session.close();
    }
  });

  app.get("/api/connections/:noteId", async (req, res) => {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (n1:Note {id: $noteId})-[b:BRIDGES]-(n2:Note)
         MATCH (v:Vault)-[:CONTAINS]->(n2)
         RETURN n2 { .id, .title, .contentPreview } AS note,
                v.name AS vault,
                b.similarity AS similarity,
                b.bridgeScore AS bridgeScore,
                b.explanation AS explanation
         ORDER BY b.bridgeScore DESC`,
        { noteId: req.params.noteId },
      );
      res.json(
        result.records.map((r) => ({
          note: r.get("note"),
          vault: r.get("vault"),
          similarity: r.get("similarity"),
          bridgeScore: r.get("bridgeScore"),
          explanation: r.get("explanation"),
        })),
      );
    } finally {
      await session.close();
    }
  });

  app.get("/api/vaults/:id/notes", async (req, res) => {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (v:Vault {id: $id})-[:CONTAINS]->(n:Note)
         OPTIONAL MATCH (n)-[:TAGGED]->(t:Tag)
         RETURN n { .id, .title, .contentPreview } AS note,
                collect(t.name) AS tags
         ORDER BY n.title`,
        { id: req.params.id },
      );
      res.json(
        result.records.map((r) => ({
          ...r.get("note"),
          tags: r.get("tags"),
        })),
      );
    } finally {
      await session.close();
    }
  });

  app.post("/api/query", async (req, res) => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ message: "Provide a question" });
      }
      const result = await queryGraph(question);
      res.json(result);
    } catch (err: any) {
      console.error("Query error:", err);
      res.status(500).json({ message: err.message || "Query failed" });
    }
  });

  app.post("/api/explore/run-discovery", async (_req, res) => {
    try {
      await discoverBridges();
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Discovery error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/explore/communities", async (_req, res) => {
    try {
      const communities = await runCommunityDetection();
      res.json(communities);
    } catch (err: any) {
      console.error("Communities error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/explore/leiden", async (_req, res) => {
    try {
      const communities = await runLeiden();
      res.json(communities);
    } catch (err: any) {
      console.error("Leiden error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/explore/centrality", async (_req, res) => {
    try {
      const nodes = await runCentrality();
      res.json(nodes);
    } catch (err: any) {
      console.error("Centrality error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/explore/pagerank", async (_req, res) => {
    try {
      const nodes = await runPageRank();
      res.json(nodes);
    } catch (err: any) {
      console.error("PageRank error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/explore/path", async (req, res) => {
    try {
      const { from, to } = req.body;
      if (!from || !to) return res.status(400).json({ message: "Provide from and to note titles" });
      const result = await findShortestPath(from, to);
      res.json(result);
    } catch (err: any) {
      console.error("Path error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/notes/:id", async (req, res) => {
    const session = driver.session();
    try {
      const noteResult = await session.run(
        `MATCH (v:Vault)-[:CONTAINS]->(n:Note {id: $id})
         OPTIONAL MATCH (n)-[:TAGGED]->(t:Tag)
         RETURN n { .id, .title, .content, .contentPreview, .betweenness, .community } AS note,
                v.name AS vault, collect(DISTINCT t.name) AS tags`,
        { id: req.params.id },
      );
      if (noteResult.records.length === 0) {
        return res.status(404).json({ message: "Note not found" });
      }
      const r = noteResult.records[0];

      const connectionsResult = await session.run(
        `MATCH (n:Note {id: $id})-[b:BRIDGES]-(other:Note)
         MATCH (v:Vault)-[:CONTAINS]->(other)
         RETURN other { .id, .title, .contentPreview } AS note,
                v.name AS vault, b.similarity AS similarity, b.bridgeScore AS bridgeScore
         ORDER BY b.bridgeScore DESC
         LIMIT 15`,
        { id: req.params.id },
      );

      const linksResult = await session.run(
        `MATCH (n:Note {id: $id})-[:LINKS_TO]-(other:Note)
         MATCH (v:Vault)-[:CONTAINS]->(other)
         RETURN other { .id, .title } AS note, v.name AS vault`,
        { id: req.params.id },
      );

      res.json({
        ...r.get("note"),
        vault: r.get("vault"),
        tags: r.get("tags"),
        bridges: connectionsResult.records.map((cr) => ({
          ...cr.get("note"),
          vault: cr.get("vault"),
          similarity: cr.get("similarity"),
          bridgeScore: cr.get("bridgeScore"),
        })),
        links: linksResult.records.map((lr) => ({
          ...lr.get("note"),
          vault: lr.get("vault"),
        })),
      });
    } finally {
      await session.close();
    }
  });

  app.get("/api/explore/graph", async (_req, res) => {
    const session = driver.session();
    try {
      const nodesResult = await session.run(
        `MATCH (v:Vault)-[:CONTAINS]->(n:Note)
         RETURN n.id AS id, n.title AS title, v.id AS vaultId, v.name AS vaultName, n.community AS community`,
      );

      // Generate short names for top communities using distinctive note titles
      const communityNamesResult = await session.run(
        `MATCH (v:Vault)-[:CONTAINS]->(n:Note)
         WHERE n.community IS NOT NULL
         WITH n.community AS community, n.title AS title, v.name AS vault, count{(n2:Note {community: n.community})} AS size
         WITH community, collect(DISTINCT title) AS titles, collect(DISTINCT vault) AS vaults, size
         ORDER BY size DESC LIMIT 20
         WITH community, size,
           [t IN titles WHERE size(t) > 2 AND size(t) < 30
            AND NOT t IN ['README', 'index', 'SUMMARY', 'CHANGELOG', 'LICENSE', 'Home', 'template']
           ][..3] AS sampleTitles
         RETURN community, sampleTitles, size`,
      );
      const communityNames: Record<number, string> = {};
      for (const r of communityNamesResult.records) {
        const cid = r.get("community");
        const id = typeof cid === "object" && "low" in cid ? cid.low : cid;
        const titles: string[] = r.get("sampleTitles");
        const name = titles.length > 0 ? titles.slice(0, 2).join(", ") : `Cluster ${id}`;
        communityNames[id] = name;
      }
      const nodes = nodesResult.records.map((r) => {
        const community = r.get("community");
        return {
          id: r.get("id"),
          title: r.get("title"),
          vaultId: r.get("vaultId"),
          vaultName: r.get("vaultName"),
          community: community != null ? (typeof community === "object" && "low" in community ? community.low : community) : null,
        };
      });

      const linksResult = await session.run(
        `MATCH (a:Note)-[r:LINKS_TO]->(b:Note)
         RETURN a.id AS source, b.id AS target, 'link' AS type`,
      );
      const bridgesResult = await session.run(
        `MATCH (a:Note)-[b:BRIDGES]-(b2:Note)
         WHERE a.id < b2.id AND b.bridgeScore > 0.3
         RETURN a.id AS source, b2.id AS target, 'bridge' AS type,
                b.similarity AS similarity, b.bridgeScore AS bridgeScore
         ORDER BY b.bridgeScore DESC
         LIMIT 300`,
      );

      const links = [
        ...linksResult.records.map((r) => ({
          source: r.get("source"),
          target: r.get("target"),
          type: r.get("type"),
        })),
        ...bridgesResult.records.map((r) => ({
          source: r.get("source"),
          target: r.get("target"),
          type: r.get("type"),
          similarity: r.get("similarity"),
          bridgeScore: r.get("bridgeScore"),
        })),
      ];

      res.json({ nodes, links, communityNames });
    } finally {
      await session.close();
    }
  });

  app.get("/api/explore/stats", async (_req, res) => {
    const session = driver.session();
    try {
      const result = await session.run(
        `OPTIONAL MATCH (n:Note) WITH count(n) AS noteCount
         OPTIONAL MATCH ()-[l:LINKS_TO]->() WITH noteCount, count(l) AS linkCount
         OPTIONAL MATCH ()-[b:BRIDGES]-() WITH noteCount, linkCount, count(b)/2 AS bridgeCount
         OPTIONAL MATCH (v:Vault) WITH noteCount, linkCount, bridgeCount, count(v) AS vaultCount
         RETURN noteCount, linkCount, bridgeCount, vaultCount`,
      );
      const r = result.records[0];
      res.json({
        notes: (r.get("noteCount") as any)?.toNumber?.() ?? r.get("noteCount") ?? 0,
        links: (r.get("linkCount") as any)?.toNumber?.() ?? r.get("linkCount") ?? 0,
        bridges: (r.get("bridgeCount") as any)?.toNumber?.() ?? r.get("bridgeCount") ?? 0,
        vaults: (r.get("vaultCount") as any)?.toNumber?.() ?? r.get("vaultCount") ?? 0,
      });
    } finally {
      await session.close();
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
