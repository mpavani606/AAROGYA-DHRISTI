export function missingChunkIndexes(totalChunks: number, received: number[]) {
  const found = new Set(received);
  return Array.from({ length: totalChunks }, (_, index) => index).filter((index) => !found.has(index));
}

export function requiresConflictReview(opType: string) {
  return opType === "signed_review" || opType === "signed_note";
}
