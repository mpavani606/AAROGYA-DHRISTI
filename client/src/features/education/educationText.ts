export function splitSentences(text: string) {
  return text.split(/(?<=[.!?।])\s+|\n+/u).map((part) => part.trim()).filter(Boolean);
}
