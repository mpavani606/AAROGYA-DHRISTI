const prohibitedCopy = [
  /\byou\s+do\s+not\s+have\s+cancer\b/i,
  /\byou\s+have\s+cancer\b/i,
  /\bcancer[\s-]*free\b/i,
  /\bno\s+evidence\s+of\s+cancer\b/i,
  /\bnormal\b/i,
  /\bsafe\b/i
];

export function educationCopyIsAllowed(text: string) {
  return prohibitedCopy.every((pattern) => !pattern.test(text));
}
