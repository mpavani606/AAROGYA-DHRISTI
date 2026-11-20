import { expect, test } from "@playwright/test";

test("legacy register route opens patient registration", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-language-selected", "true");
  });
  await page.goto("/register");

  await expect(page).toHaveURL(/\/patient\/register$/);
  await expect(page.getByRole("heading", { name: "Patient registration" })).toBeVisible();
});
