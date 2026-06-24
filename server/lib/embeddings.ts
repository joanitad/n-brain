import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-mpnet-base-v2");
  }
  return extractor;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const ext = await getExtractor();
  const results: number[][] = [];

  for (const text of texts) {
    const output = await ext(text, { pooling: "mean", normalize: true });
    results.push(Array.from(output.data as Float32Array));
  }

  return results;
}

export function buildEmbeddingText(
  title: string,
  preview: string,
  tags: string[],
): string {
  const parts = [title];
  if (preview) parts.push(preview);
  if (tags.length) parts.push(`Tags: ${tags.join(", ")}`);
  return parts.join("\n");
}

export const EMBEDDING_DIMENSIONS = 768;
