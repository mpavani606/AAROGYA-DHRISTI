export function chunkReviewedText(text: string, maxWords = 230, overlapWords = 30) {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  const chunks: string[] = [];
  for (let start = 0; start < words.length; start += maxWords - overlapWords) {
    const chunk = words.slice(start, start + maxWords).join(" ");
    if (chunk) chunks.push(chunk);
    if (start + maxWords >= words.length) break;
  }
  return chunks;
}
