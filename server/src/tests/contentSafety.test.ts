import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("patient-facing content safety", () => {
  it("keeps prohibited reassurance and diagnosis phrases out of patient-facing locale strings", async () => {
    const localeDir = path.resolve(process.cwd(), "../client/src/i18n/locales");
    const files = await Promise.all(["en.json", "te.json", "hi.json"].map((file) => readFile(path.join(localeDir, file), "utf8")));
    const content = files.join("\n").toLowerCase();
    for (const phrase of ["you do not have cancer", "you have cancer", '"normal"', '"safe"']) {
      expect(content).not.toContain(phrase);
    }
  });
});
