import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "password",
  ),
);

export async function initDb() {
  const session = driver.session();
  try {
    await session.run(`CREATE CONSTRAINT vault_id IF NOT EXISTS FOR (v:Vault) REQUIRE v.id IS UNIQUE`);
    await session.run(`CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE`);
    await session.run(`CREATE CONSTRAINT tag_name IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE`);
    await session.run(`CREATE CONSTRAINT insight_id IF NOT EXISTS FOR (i:Insight) REQUIRE i.id IS UNIQUE`);

    try {
      await session.run(
        `CREATE VECTOR INDEX note_embeddings IF NOT EXISTS
         FOR (n:Note) ON (n.embedding)
         OPTIONS {indexConfig: {
           \`vector.dimensions\`: 768,
           \`vector.similarity_function\`: 'cosine'
         }}`,
      );
    } catch {
      // vector index may already exist or not be supported
    }
  } finally {
    await session.close();
  }
}

export { driver };
