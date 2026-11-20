import { expect, test } from "@playwright/test";

test("first visit requires a language before opening the application", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("img", { name: "AAROGYA DRISHTI" })).toBeVisible();
  await expect(page.getByRole("img", { name: "AAROGYA DRISHTI" })).toHaveCSS("position", "fixed");
  await expect(page.getByRole("img", { name: "AAROGYA DRISHTI" })).toHaveCSS("left", "8px");
  await expect(page.getByRole("heading", { name: "Select your language" })).toBeVisible();
  await page.getByRole("button", { name: "English English" }).click();
  await expect(page.getByRole("img", { name: "AAROGYA DRISHTI" })).toBeVisible();
  await expect(page.getByRole("img", { name: "AAROGYA DRISHTI" })).toHaveCSS("top", "42px");
  await expect(page.getByRole("heading", { name: "Aarogya Drishti", exact: true })).toBeVisible();
  await expect(page.locator(".ad-topbar-actions").getByRole("link", { name: "Patient login" })).toBeVisible();
  await expect(page.locator(".ad-topbar-actions").getByRole("link", { name: "Doctor login" })).toBeVisible();
  await page.getByRole("button", { name: "తెలుగు" }).click();
  await expect(page.getByRole("img", { name: "ఆరోగ్య దృష్టి" })).toBeVisible();
  await page.getByRole("button", { name: "हिंदी" }).click();
  await expect(page.getByRole("img", { name: "आरोग्य दृष्टि" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Aarogya Drishti" })).toHaveCount(0);
  await page.goto("/home");
  await expect(page.getByRole("img", { name: "आरोग्य दृष्टि" })).toBeVisible();
  await expect(page.locator(".rd-brand")).toHaveCount(0);
});
