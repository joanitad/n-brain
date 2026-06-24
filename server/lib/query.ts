import { driver } from "../db";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:20b";

const SCHEMA_CONTEXT = `
Neo4j graph schema:
- (:Vault {id, name, noteCount, createdAt})-[:CONTAINS]->(:Note)
- (:Note {id, title, content, contentPreview, embedding, createdAt})
- (:Note)-[:LINKS_TO]->(:Note)  // within-vault wikilinks
- (:Note)-[:BRIDGES {similarity, bridgeScore}]-(:Note)  // cross-vault AI-discovered connections
- (:Note)-[:TAGGED]->(:Tag {name})

Notes:
- BRIDGES are undirected (no arrow direction matters)
- bridgeScore = similarity * domainDistance (higher = more surprising cross-domain connection)
- similarity is cosine similarity of embeddings (0-1)
- Each Note belongs to exactly one Vault via CONTAINS
- Tags come from Obsidian #tags and frontmatter
`;

async function ollamaChat(system: string, prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.statusText}`);
  const data = await res.json();
  return data.message.content;
}

export async function queryGraph(question: string): Promise<{ answer: string; cypher?: string; rawResults?: any[] }> {
  const cypherRaw = await ollamaChat(
    `You are a Neo4j Cypher query generator. Given a natural language question about a knowledge graph, generate a Cypher query to answer it.

${SCHEMA_CONTEXT}

Rules:
- Return ONLY the Cypher query, no explanation, no markdown fences
- Use LIMIT to keep results manageable (max 25 rows)
- Always return useful columns with aliases
- If the question is about a specific note, use case-insensitive CONTAINS matching on title
- Keep queries simple and correct

Example queries:

Q: What are the most connected notes?
MATCH (n:Note)
OPTIONAL MATCH (n)-[r]-()
WITH n, count(r) AS connections
MATCH (v:Vault)-[:CONTAINS]->(n)
RETURN n.title AS note, v.name AS vault, connections
ORDER BY connections DESC LIMIT 10

Q: What tags are most common?
MATCH (t:Tag)<-[:TAGGED]-(n:Note)
RETURN t.name AS tag, count(n) AS noteCount
ORDER BY noteCount DESC LIMIT 20

Q: Find cross-vault bridges about algorithms
MATCH (n1:Note)-[b:BRIDGES]-(n2:Note)
WHERE toLower(n1.title) CONTAINS 'algorithm' OR toLower(n2.title) CONTAINS 'algorithm'
MATCH (v1:Vault)-[:CONTAINS]->(n1), (v2:Vault)-[:CONTAINS]->(n2)
RETURN n1.title AS noteA, v1.name AS vaultA, n2.title AS noteB, v2.name AS vaultB, b.bridgeScore AS score
ORDER BY b.bridgeScore DESC LIMIT 10

Q: Which vaults have the most bridges between them?
MATCH (v1:Vault)-[:CONTAINS]->(n1:Note)-[b:BRIDGES]-(n2:Note)<-[:CONTAINS]-(v2:Vault)
WHERE v1.name < v2.name
RETURN v1.name AS vault1, v2.name AS vault2, count(b) AS bridges
ORDER BY bridges DESC LIMIT 10

Q: Find notes about X that connect to notes about Y
MATCH (n1:Note)-[b:BRIDGES]-(n2:Note)
WHERE toLower(n1.title) CONTAINS 'x' AND toLower(n2.title) CONTAINS 'y'
MATCH (v1:Vault)-[:CONTAINS]->(n1), (v2:Vault)-[:CONTAINS]->(n2)
RETURN n1.title AS noteA, v1.name AS vaultA, n2.title AS noteB, v2.name AS vaultB, b.bridgeScore AS score
ORDER BY score DESC LIMIT 10

IMPORTANT: For graph algorithms (community detection, centrality, pagerank, shortest path), do NOT use GDS directly. Instead use the pre-computed properties on Note nodes:
- n.community (Louvain community ID)
- n.betweenness (betweenness centrality score)
These are already computed and stored on nodes. Just query them directly.

Q: Find communities / clusters of notes
MATCH (v:Vault)-[:CONTAINS]->(n:Note)
WHERE n.community IS NOT NULL
WITH n.community AS community, collect(n.title)[..5] AS sampleNotes, collect(DISTINCT v.name) AS vaults, count(n) AS size
RETURN community, sampleNotes, vaults, size
ORDER BY size DESC LIMIT 20

Q: Find the most important bridge notes
MATCH (v:Vault)-[:CONTAINS]->(n:Note)
WHERE n.betweenness IS NOT NULL AND n.betweenness > 0
RETURN n.title AS note, v.name AS vault, n.betweenness AS score
ORDER BY score DESC LIMIT 20

Q: Which communities span the most vaults?
MATCH (v:Vault)-[:CONTAINS]->(n:Note)
WHERE n.community IS NOT NULL
WITH n.community AS community, collect(DISTINCT v.name) AS vaults, count(n) AS size
WHERE size(vaults) > 1
RETURN community, vaults, size
ORDER BY size(vaults) DESC, size DESC LIMIT 20

Additional node properties available for interdisciplinary discovery:
- n.degree (number of connections)
- n.clusteringCoeff (how clustered a note's neighbors are, 0-1. Low = generalist spanning domains)
- n.betweenness (how much the note bridges different parts of the graph)
- n.pagerank (overall importance)

Q: Find generalist notes that span multiple domains
MATCH (v:Vault)-[:CONTAINS]->(n:Note)
WHERE n.degree > 5 AND n.clusteringCoeff < 0.1 AND n.clusteringCoeff >= 0
AND NOT n.title IN ['README', 'index', 'SUMMARY', 'CONTRIBUTING']
RETURN n.title AS note, v.name AS vault, n.degree AS connections, round(n.clusteringCoeff * 1000) / 1000 AS clusteringCoeff
ORDER BY n.degree DESC LIMIT 15

Q: Find notes that bridge the most different communities
MATCH (v:Vault)-[:CONTAINS]->(n:Note)
WHERE n.betweenness > 0
OPTIONAL MATCH (n)-[:BRIDGES]-(other:Note)
WHERE other.community <> n.community
WITH n, v, n.betweenness AS betweenness, count(DISTINCT other.community) AS communitiesConnected
WHERE communitiesConnected >= 3
RETURN n.title AS note, v.name AS vault, betweenness, communitiesConnected
ORDER BY communitiesConnected DESC, betweenness DESC LIMIT 15

Q: Find interdisciplinary bridges between different communities
MATCH (n1:Note)-[b:BRIDGES]-(n2:Note)
WHERE n1.community <> n2.community AND n1.id < n2.id
AND NOT n1.title IN ['README', 'index', 'CONTRIBUTING']
AND NOT n2.title IN ['README', 'index', 'CONTRIBUTING']
MATCH (v1:Vault)-[:CONTAINS]->(n1), (v2:Vault)-[:CONTAINS]->(n2)
WHERE v1 <> v2
RETURN n1.title AS noteA, v1.name AS vaultA, n2.title AS noteB, v2.name AS vaultB, round(b.similarity * 100) / 100 AS similarity
ORDER BY b.similarity DESC LIMIT 15`,
    question,
  );

  const cypher = cypherRaw
    .replace(/```cypher\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  const session = driver.session();
  let rawResults: any[];
  try {
    const result = await session.run(cypher);
    rawResults = result.records.map((r) => {
      const obj: any = {};
      r.keys.forEach((key) => {
        const val = r.get(key);
        if (val && typeof val === "object" && "low" in val) {
          obj[key] = val.low;
        } else if (val && typeof val === "object" && val.properties) {
          obj[key] = val.properties;
        } else {
          obj[key] = val;
        }
      });
      return obj;
    });
  } catch (err: any) {
    return {
      answer: `I generated a Cypher query but it failed: ${err.message}\n\nQuery was:\n\`\`\`\n${cypher}\n\`\`\``,
      cypher,
    };
  } finally {
    await session.close();
  }

  const answer = await ollamaChat(
    "You answer questions about a knowledge graph. Given query results, provide a clear, concise answer. Use markdown for formatting. Focus on the interesting insights and connections.",
    `Question: ${question}\n\nQuery results (${rawResults.length} rows):\n${JSON.stringify(rawResults, null, 2)}`,
  );

  return { answer, cypher, rawResults };
}
