import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { EducationPage } from "../models/EducationPage.js";
import { KnowledgeChunk } from "../models/KnowledgeChunk.js";
import { chunkReviewedText } from "./chunkText.js";
import { openAiJson } from "./openai.js";

type EmbeddingResponse = { data: Array<{ embedding: number[] }> };

async function embeddingFor(text: string) {
  const response = await openAiJson<EmbeddingResponse>("embeddings", { model: env.OPENAI_EMBEDDING_MODEL, input: text });
  const embedding = response.data[0]?.embedding;
  if (!embedding?.length) throw new Error("Embedding service returned no vector.");
  return embedding;
}

export async function ingestReviewedEducation() {
  const pages = await EducationPage.find({ status: { $in: ["reviewed", "published"] }, reviewedBy: { $exists: true }, reviewedAt: { $exists: true } })
    .select("slug body_en body_te body_hi reviewedBy updatedAt").lean();
  const approvedSlugs = pages.map((page) => page.slug);
  if (approvedSlugs.length) await KnowledgeChunk.deleteMany({ sourceSlug: { $nin: approvedSlugs } });
  else await KnowledgeChunk.deleteMany({});
  let inserted = 0;
  for (const page of pages) {
    for (const language of ["en", "te", "hi"] as const) {
      const text = page[`body_${language}`];
      const chunks = chunkReviewedText(text);
      const sourceHash = createHash("sha256").update(text).digest("hex");
      const prepared = chunks.map((chunk, index) => ({
        chunk,
        chunkHash: createHash("sha256").update(`${sourceHash}:${index}:${chunk}`).digest("hex")
      }));
      if (prepared.length) {
        await KnowledgeChunk.deleteMany({ sourceSlug: page.slug, language, contentHash: { $nin: prepared.map((item) => item.chunkHash) } });
      } else {
        await KnowledgeChunk.deleteMany({ sourceSlug: page.slug, language });
      }
      for (const { chunk, chunkHash } of prepared) {
        const exists = await KnowledgeChunk.exists({ sourceSlug: page.slug, language, contentHash: chunkHash });
        if (exists) continue;
        const embedding = await embeddingFor(chunk);
        await KnowledgeChunk.updateOne(
          { sourceSlug: page.slug, language, contentHash: chunkHash },
          { $setOnInsert: { text: chunk, language, sourceSlug: page.slug, reviewedBy: page.reviewedBy, embedding, contentHash: chunkHash, sourceUpdatedAt: page.updatedAt } },
          { upsert: true }
        );
        inserted += 1;
      }
    }
  }
  return { reviewedPages: pages.length, insertedChunks: inserted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  mongoose.connect(env.MONGODB_URI)
    .then(ingestReviewedEducation)
    .then((result) => console.log(`Education RAG ingested: ${result.reviewedPages} reviewed pages, ${result.insertedChunks} new chunks.`))
    .then(() => mongoose.disconnect())
    .catch(async (error: unknown) => {
      console.error("Education RAG ingestion failed.", error);
      await mongoose.disconnect();
      process.exitCode = 1;
    });
}
