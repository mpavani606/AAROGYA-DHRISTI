import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, runPage) => {
    await page.addInitScript(() => {
      if (window.location.search !== "?language-unselected") {
        sessionStorage.setItem("aarogya-language-selected", "true");
      }
    });
    await runPage(page);
  }
});

export { expect };
