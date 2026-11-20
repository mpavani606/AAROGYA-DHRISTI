import { env } from "../config/env.js";
import { KnowledgeChunk } from "../models/KnowledgeChunk.js";
import { openAiJson } from "./openai.js";

type EmbeddingResponse = { data: Array<{ embedding: number[] }> };
type SearchRow = { text: string; language: "en" | "te" | "hi"; sourceSlug: string; score: number };

export type RetrievedPassage = { text: string; sourceSlug: string; score: number };

export function filterByRagThreshold(rows: SearchRow[], threshold: number) {
  if (!rows.length || rows[0].score < threshold) return [];
  return rows.filter((row) => row.score >= threshold).map(({ text, sourceSlug, score }) => ({ text, sourceSlug, score }));
}

export async function searchKnowledge(query: string, language: "en" | "te" | "hi", limit = env.RAG_TOP_K): Promise<RetrievedPassage[]> {
  const response = await openAiJson<EmbeddingResponse>("embeddings", { model: env.OPENAI_EMBEDDING_MODEL, input: query });
  const vector = response.data[0]?.embedding;
  if (!vector?.length) throw Object.assign(new Error("Knowledge search returned no query embedding."), { status: 502, code: "RAG_EMBEDDING_EMPTY" });
  const rows = await KnowledgeChunk.aggregate<SearchRow>([
    {
      $vectorSearch: {
        index: env.RAG_VECTOR_INDEX,
        path: "embedding",
        queryVector: vector,
        numCandidates: Math.max(limit * 20, 100),
        limit,
        filter: { language }
      }
    },
    { $project: { _id: 0, text: 1, sourceSlug: 1, language: 1, score: { $meta: "vectorSearchScore" } } }
  ]);
  return filterByRagThreshold(rows, env.RAG_MIN_SCORE);
}
