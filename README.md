# n-brain

A cross-vault serendipity engine. Import multiple Obsidian vaults and discover surprising connections between ideas across them.

## Why

No Obsidian plugin exists that merges multiple vaults' graphs or finds cross-vault connections. n-brain fills that gap — import vaults from different people or different domains, and an AI-powered engine surfaces interdisciplinary bridges you'd never find manually.

## How it works — the full pipeline

### Step 1: Parse the vault

When you import a vault (GitHub URL, local path, or ZIP), the parser (`server/lib/vault-parser.ts`) walks every `.md` file and extracts:

```
my-note.md
├── Title: filename without .md
├── Content: plain text (markdown stripped)
├── Tags: from #hashtags and YAML frontmatter
└── Outgoing links: from [[wikilinks]]
```

### Step 2: Create nodes and relationships in Neo4j

The route handler (`server/routes.ts`) builds the graph in this order:

```
1. CREATE (:Vault {id, name})

2. For each note:
   CREATE (:Vault)-[:CONTAINS]->(:Note {id, title, content, ...})

   For each tag in the note:
   MERGE (:Tag {name})
   CREATE (:Note)-[:TAGGED]->(:Tag)

3. For each [[wikilink]] in a note:
   Match the target note by title within the same vault
   CREATE (:Note)-[:LINKS_TO]->(:Note)
```

After importing a vault:

```
(:Vault)──CONTAINS──>(:Note)──LINKS_TO──>(:Note)
                        │
                     TAGGED
                        │
                        v
                     (:Tag)
```

### Step 3: Generate embeddings

Each note gets a 768-dimension vector from `all-mpnet-base-v2` (runs locally, no API key needed). The embedding is built from `title + content preview + tags` and stored directly on the Note node as `n.embedding`.

### Step 4: Discover cross-vault bridges (GDS)

Two methods create `BRIDGES` relationships between notes in **different** vaults:

**KNN on embeddings** (`gds.knn`) — "these notes mean similar things"

```
Project graph with embedding property
→ KNN finds top 5 semantically similar notes per node
→ Filter to cross-vault pairs only
→ Filter out same-title matches (Python ↔ Python is boring)
→ MERGE (:Note)-[:BRIDGES {similarity}]-(:Note)
```

**Node similarity** (`gds.nodeSimilarity`) — "these notes share neighbors"

```
Project graph with LINKS_TO + TAGGED edges
→ Find notes with shared graph neighbors
→ Filter to cross-vault pairs
→ MERGE (:Note)-[:BRIDGES {similarity}]-(:Note)
```

Bridge scoring penalizes obvious same-topic matches and rewards genuinely surprising cross-domain connections.

### Step 5: Run graph algorithms (GDS)

All computed on the projected graph and written back as node properties:

```
gds.leiden      → n.community    (which cluster this note belongs to)
gds.betweenness → n.betweenness  (how much this note bridges clusters)
gds.pageRank   → n.pagerank      (overall importance)
```

### The final graph structure

```
(:Vault)──CONTAINS──>(:Note)──LINKS_TO──>(:Note)
                        │                    │
                     TAGGED              BRIDGES (cross-vault)
                        │                    │
                        v                    v
                     (:Tag)              (:Note) in another vault

Node properties:
  .embedding         [768 floats]
  .community         integer (Leiden cluster ID)
  .betweenness       float (structural bridge importance)
  .pagerank          float (overall influence)
  .degree            float (number of connections)
  .clusteringCoeff   float (0-1, how clustered neighbors are)
```

### What the frontend sees

The `/api/explore/graph` endpoint queries all of this and returns:
- **nodes**: id, title, vaultId, vaultName, community
- **links**: source→target with type (`link` or `bridge`) and similarity score
- **communityNames**: auto-generated from sample note titles per cluster

The force-directed graph renders nodes colored by vault or cluster, with wikilinks as thin edges and bridges as highlighted cross-vault connections.

### Cluster discovery

Clusters are found using **Leiden community detection** (`gds.leiden`). Leiden is an improvement over the classic Louvain algorithm — it guarantees that all discovered communities are well-connected internally (no disconnected subclusters).

The algorithm groups notes that are more densely connected to each other than to the rest of the graph. It doesn't read content; it only sees edges. Three relationship types feed into it:

1. **LINKS_TO** — explicit `[[wikilinks]]` within vaults (author-created connections)
2. **TAGGED** — notes sharing the same tag node (implicit connection through shared topics)
3. **BRIDGES** — cross-vault connections discovered via KNN on embeddings

Clusters naturally span multiple vaults because of the bridge edges. If Vault A has a note about "distributed systems" that links to "consensus algorithms," and Vault B has a note about "Kubernetes" that's bridged to Vault A's "distributed systems" via embeddings, Leiden pulls them into the same community because they're transitively connected.

Each cluster is auto-named using sample note titles from that community.

#### Clustering algorithms available

| Algorithm | Endpoint | What it finds |
|---|---|---|
| **Leiden** (default) | `POST /api/explore/leiden` | Well-connected communities. Guarantees no disconnected subclusters. |
| **Louvain** | `POST /api/explore/communities` | Classic community detection. Faster but can produce poorly connected communities. |
| **Label Propagation** | Available via GDS | Fast rough clusters. Less precise, finds different boundaries. |
| **Weakly Connected Components** | Available via GDS | Isolated subgraphs. Binary — connected or not, no nuance. |
| **K-Means on embeddings** | Available via GDS | Semantic clusters. Ignores graph structure, groups by meaning only. |

### Finding interdisciplinary ideas

The core goal of n-brain is surfacing connections between unrelated fields. Three graph algorithm patterns detect these — no AI interpretation, pure graph structure:

#### 1. Inter-community bridges

Notes that are semantically similar but belong to different Leiden clusters. These are ideas that emerged independently in separate knowledge domains.

```
"Find interdisciplinary bridges between different communities"
```

Example findings:
- "data_viz" (Jethro, cluster 187) ↔ "Data Visualization" (David, cluster 594) — same concept, completely different graph neighborhoods
- "GRAPH_REPORT" (Golden Forest) ↔ "wood_wide_web" (Jethro) — infrastructure graphs meet biological networks
- "COVID-19" (David, handbook) ↔ "It's tough to live life amid all these circumstances" (Mike, personal reflections) — factual connects to emotional

#### 2. Generalist nodes (low clustering coefficient, high degree)

Notes connected to many different groups whose neighbors are NOT connected to each other. These are concepts that span multiple domains — the hubs where disciplines meet.

```
"Find generalist notes that span multiple domains"
```

A note with degree 50 but clustering coefficient 0.07 means: it touches 50 other notes, but those 50 notes barely know each other. That's a concept like "Time", "Learning", or "Ideas" that appears across philosophy, productivity, CS, and biology without belonging to any one field.

#### 3. Structural bridge nodes (high betweenness, multi-community)

Notes where removing them would disconnect parts of the graph. They're the only path between two knowledge domains.

```
"Find notes that bridge the most different communities"
```

Example: "Take notes in your own words" (Mike Tannenbaum) bridges 5 communities — it connects note-taking methodology to programming, reading, tools, and personal knowledge management.

#### All properties are queryable

| Property | What it means | How to use it |
|---|---|---|
| `n.community` | Leiden cluster membership | Find notes in same/different clusters |
| `n.betweenness` | Structural bridge importance | High = sits between different domains |
| `n.degree` | Number of connections | High = well-connected |
| `n.clusteringCoeff` | How clustered neighbors are (0-1) | Low + high degree = generalist spanning domains |
| `n.pagerank` | Overall influence | High = important concept in the graph |

### Natural language queries

Ask questions in plain English via the query bar. A local LLM (Ollama) translates your question into a Cypher query, runs it against Neo4j, and summarizes the results. Examples:

- "Find generalist notes that span multiple domains"
- "Find notes that bridge the most different communities"
- "Find interdisciplinary bridges between different communities"
- "Which communities span the most different vaults?"
- "What are the most connected notes across vaults?"
- "What tags are shared across the most vaults?"

## Architecture

- **Frontend**: React 18, Tailwind, react-force-graph-2d
- **Backend**: Express, TypeScript
- **Database**: Neo4j 5 with Graph Data Science plugin
- **Embeddings**: all-mpnet-base-v2 via @xenova/transformers (local, no API key)
- **NL Queries**: Ollama with any local model (default: gpt-oss:20b)

## Setup

### Prerequisites

- Node.js 18+
- Docker (for Neo4j)
- Ollama (optional, for natural language queries)

### Run

```bash
# Start Neo4j
docker compose up -d

# Install dependencies
npm install

# Start dev server
PORT=5001 npm run dev
```

### Import vaults

Open `http://localhost:5001` and use the import form:

- **GitHub**: paste a repo URL (e.g., `https://github.com/kepano/kepano-obsidian`)
- **Local path**: point to a vault folder on your machine
- **ZIP**: upload a zipped vault

### Explore

- **Dashboard** (`/`): imported vaults + serendipity feed of top bridges
- **Explore** (`/explore`): interactive force-directed graph with:
  - Toggle links/bridges visibility
  - Color by vault or by cluster
  - Click nodes to see note content + connections in a side panel
  - Natural language query bar
  - Filter by vault

## API

```
Vaults:
  POST /api/vaults/upload         Import vault (GitHub URL, local path, or ZIP)
  GET  /api/vaults                List all vaults
  DELETE /api/vaults/:id          Remove a vault and its notes

Discovery:
  GET  /api/feed                  Serendipity feed (top bridges)
  GET  /api/connections/:noteId   Bridges for a specific note
  GET  /api/notes/:id             Note detail with content + connections

Graph algorithms:
  POST /api/explore/run-discovery Re-run bridge discovery + GDS algorithms
  POST /api/explore/leiden         Leiden community detection (recommended)
  POST /api/explore/communities   Louvain community detection
  POST /api/explore/centrality    Betweenness centrality
  POST /api/explore/pagerank      PageRank
  POST /api/explore/path          Shortest path between two notes
  GET  /api/explore/graph         Full graph data for visualization
  GET  /api/explore/stats         Graph statistics

Queries:
  POST /api/query                 Natural language query (requires Ollama)
```
