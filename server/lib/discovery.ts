import { driver } from "../db";

export async function discoverBridges() {
  const session = driver.session();
  try {
    // Drop existing graph projection if it exists
    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});

    // Project the graph: Notes connected by LINKS_TO and TAGGED relationships
    await session.run(
      `CALL gds.graph.project(
        'brain-graph',
        'Note',
        {
          LINKS_TO: { orientation: 'UNDIRECTED' },
          TAGGED_SAME: {
            type: 'TAGGED',
            orientation: 'UNDIRECTED',
            properties: {}
          }
        }
      )`,
    );

    // Node Similarity — finds structurally similar notes based on shared neighbors
    // (shared tags, shared link targets). Cross-vault pairs are the interesting ones.
    await session.run(
      `CALL gds.nodeSimilarity.stream('brain-graph', {
        similarityCutoff: 0.1,
        topK: 10
      })
      YIELD node1, node2, similarity
      WITH gds.util.asNode(node1) AS n1, gds.util.asNode(node2) AS n2, similarity
      // Only keep cross-vault bridges
      MATCH (v1:Vault)-[:CONTAINS]->(n1), (v2:Vault)-[:CONTAINS]->(n2)
      WHERE v1 <> v2
      MERGE (n1)-[b:BRIDGES]-(n2)
      ON CREATE SET b.similarity = similarity, b.createdAt = datetime()
      ON MATCH SET b.similarity = similarity`,
    );

    // Betweenness centrality — find bridge nodes
    await session.run(
      `CALL gds.betweenness.stream('brain-graph')
      YIELD nodeId, score
      WITH gds.util.asNode(nodeId) AS n, score
      WHERE score > 0
      SET n.betweenness = score`,
    );

    // Community detection — Leiden produces better-connected clusters than Louvain
    await session.run(
      `CALL gds.leiden.stream('brain-graph')
      YIELD nodeId, communityId
      WITH gds.util.asNode(nodeId) AS n, communityId
      SET n.community = communityId`,
    );

    // Compute bridge scores: high similarity + cross-domain = high score
    await session.run(
      `MATCH (v1:Vault)-[:CONTAINS]->(n1:Note)-[b:BRIDGES]-(n2:Note)<-[:CONTAINS]-(v2:Vault)
       WHERE v1 <> v2
       WITH n1, n2, b, v1, v2
       OPTIONAL MATCH (v1)-[:CONTAINS]->(:Note)-[:TAGGED]->(t1:Tag)
       WITH n1, n2, b, v2, collect(DISTINCT t1.name) AS tags1
       OPTIONAL MATCH (v2)-[:CONTAINS]->(:Note)-[:TAGGED]->(t2:Tag)
       WITH b, b.similarity AS sim, tags1, collect(DISTINCT t2.name) AS tags2
       WITH b, sim,
         CASE
           WHEN size(tags1) = 0 AND size(tags2) = 0 THEN 1.0
           ELSE 1.0 - (toFloat(size([t IN tags1 WHERE t IN tags2])) /
                        toFloat(size(tags1 + [t IN tags2 WHERE NOT t IN tags1])))
         END AS domainDistance
       SET b.bridgeScore = sim * domainDistance`,
    );

    // Clean up projection
    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});
  } finally {
    await session.close();
  }
}

export async function runCommunityDetection() {
  const session = driver.session();
  try {
    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});
    await session.run(
      `CALL gds.graph.project('brain-graph', 'Note', {
        LINKS_TO: { orientation: 'UNDIRECTED' },
        BRIDGES: { orientation: 'UNDIRECTED' }
      })`,
    );

    const result = await session.run(
      `CALL gds.louvain.stream('brain-graph')
       YIELD nodeId, communityId
       WITH gds.util.asNode(nodeId) AS n, communityId
       MATCH (v:Vault)-[:CONTAINS]->(n)
       RETURN communityId, collect(n.title)[..5] AS sampleNotes,
              collect(DISTINCT v.name) AS vaults, count(n) AS size
       ORDER BY size DESC
       LIMIT 20`,
    );

    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});

    return result.records.map((r) => ({
      communityId: (r.get("communityId") as any)?.toNumber?.() ?? r.get("communityId"),
      sampleNotes: r.get("sampleNotes"),
      vaults: r.get("vaults"),
      size: (r.get("size") as any)?.toNumber?.() ?? r.get("size"),
    }));
  } finally {
    await session.close();
  }
}

export async function runLeiden() {
  const session = driver.session();
  try {
    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});
    await session.run(
      `CALL gds.graph.project('brain-graph', 'Note', {
        LINKS_TO: { orientation: 'UNDIRECTED' },
        BRIDGES: { orientation: 'UNDIRECTED' }
      })`,
    );

    // Write to nodes so queries and graph viz can use it
    await session.run(
      `CALL gds.leiden.stream('brain-graph')
       YIELD nodeId, communityId
       WITH gds.util.asNode(nodeId) AS n, communityId
       SET n.community = communityId`,
    );

    const result = await session.run(
      `MATCH (v:Vault)-[:CONTAINS]->(n:Note)
       WHERE n.community IS NOT NULL
       WITH n.community AS communityId, collect(n.title)[..5] AS sampleNotes,
              collect(DISTINCT v.name) AS vaults, count(n) AS size
       RETURN communityId, sampleNotes, vaults, size
       ORDER BY size DESC
       LIMIT 20`,
    );

    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});

    return result.records.map((r) => ({
      communityId: (r.get("communityId") as any)?.toNumber?.() ?? r.get("communityId"),
      sampleNotes: r.get("sampleNotes"),
      vaults: r.get("vaults"),
      size: (r.get("size") as any)?.toNumber?.() ?? r.get("size"),
    }));
  } finally {
    await session.close();
  }
}

export async function runCentrality() {
  const session = driver.session();
  try {
    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});
    await session.run(
      `CALL gds.graph.project('brain-graph', 'Note', {
        LINKS_TO: { orientation: 'UNDIRECTED' },
        BRIDGES: { orientation: 'UNDIRECTED' }
      })`,
    );

    const result = await session.run(
      `CALL gds.betweenness.stream('brain-graph')
       YIELD nodeId, score
       WITH gds.util.asNode(nodeId) AS n, score
       WHERE score > 0
       MATCH (v:Vault)-[:CONTAINS]->(n)
       RETURN n.title AS note, v.name AS vault, score
       ORDER BY score DESC
       LIMIT 20`,
    );

    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});

    return result.records.map((r) => ({
      note: r.get("note"),
      vault: r.get("vault"),
      score: r.get("score"),
    }));
  } finally {
    await session.close();
  }
}

export async function runPageRank() {
  const session = driver.session();
  try {
    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});
    await session.run(
      `CALL gds.graph.project('brain-graph', 'Note', {
        LINKS_TO: { orientation: 'UNDIRECTED' },
        BRIDGES: { orientation: 'UNDIRECTED' }
      })`,
    );

    const result = await session.run(
      `CALL gds.pageRank.stream('brain-graph')
       YIELD nodeId, score
       WITH gds.util.asNode(nodeId) AS n, score
       MATCH (v:Vault)-[:CONTAINS]->(n)
       RETURN n.title AS note, v.name AS vault, score
       ORDER BY score DESC
       LIMIT 20`,
    );

    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});

    return result.records.map((r) => ({
      note: r.get("note"),
      vault: r.get("vault"),
      score: r.get("score"),
    }));
  } finally {
    await session.close();
  }
}

export async function findShortestPath(fromTitle: string, toTitle: string) {
  const session = driver.session();
  try {
    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});
    await session.run(
      `CALL gds.graph.project('brain-graph', 'Note', {
        LINKS_TO: { orientation: 'UNDIRECTED' },
        BRIDGES: { orientation: 'UNDIRECTED' }
      })`,
    );

    const result = await session.run(
      `MATCH (source:Note), (target:Note)
       WHERE toLower(source.title) CONTAINS toLower($from)
         AND toLower(target.title) CONTAINS toLower($to)
       WITH source, target LIMIT 1
       CALL gds.shortestPath.dijkstra.stream('brain-graph', {
         sourceNode: source,
         targetNode: target
       })
       YIELD index, sourceNode, targetNode, nodeIds, costs, totalCost
       UNWIND nodeIds AS nodeId
       WITH gds.util.asNode(nodeId) AS n, totalCost
       MATCH (v:Vault)-[:CONTAINS]->(n)
       RETURN n.title AS note, v.name AS vault, totalCost
       ORDER BY n.title`,
      { from: fromTitle, to: toTitle },
    );

    await session.run(`CALL gds.graph.drop('brain-graph', false)`).catch(() => {});

    return {
      path: result.records.map((r) => ({
        note: r.get("note"),
        vault: r.get("vault"),
      })),
      totalCost: result.records[0]?.get("totalCost") ?? null,
    };
  } finally {
    await session.close();
  }
}
