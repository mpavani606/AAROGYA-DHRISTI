import { expect, test } from "./fixtures";

test("authorized staff can create a camp from the community portal", async ({ page }) => {
  const campPayloads: Array<Record<string, unknown>> = [];
  const ids = {
    mandal: "507f1f77bcf86cd799439011",
    phc: "507f1f77bcf86cd799439012",
    village: "507f1f77bcf86cd799439013"
  };
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      accessToken: "test-access-token",
      user: { id: "synthetic-admin", name: "Synthetic district admin", role: "district_admin", phone: "9000000048" }
    })
  }));
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "synthetic-admin", name: "Synthetic district admin", role: "district_admin", phone: "9000000048" } })
  }));
  await page.route("**/api/v1/community/camps/options", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      mandals: [{ _id: ids.mandal, name_en: "Synthetic mandal" }],
      phcs: [{ _id: ids.phc, name_en: "Synthetic PHC", mandal: ids.mandal }],
      villages: [{ _id: ids.village, name_en: "Synthetic village", mandal: ids.mandal, phc: ids.phc }],
      hospitals: [],
      doctors: []
    })
  }));
  await page.route("**/api/v1/community/camps", async (route) => {
    if (route.request().method() === "POST") {
      campPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ camp: {} }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ camps: [] }) });
  });
  await page.route("**/api/v1/community/emergency/requests", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ requests: [], notice: "Coordination only." })
  }));

  await page.goto("/login");
  await page.getByRole("tab", { name: /District admin/ }).click();
  await page.getByLabel("Phone").fill("9000000048");
  await page.locator('input[type="password"]').fill("Demo12345!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.goto("/community");

  await expect(page.getByRole("heading", { name: "Community health network" })).toBeVisible();
  await expect(page.getByText("No camps are scheduled in your authorized area.")).toBeVisible();
  await page.getByLabel("Camp name").fill("Synthetic outreach camp");
  const start = new Date(Date.now() + 86_400_000);
  const end = new Date(start.getTime() + 3_600_000);
  const localDateTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("Starts").fill(localDateTime(start));
  await page.getByLabel("Ends").fill(localDateTime(end));
  await page.getByLabel("Mandal").selectOption(ids.mandal);
  await page.getByLabel("PHC").selectOption(ids.phc);
  await page.getByLabel("Village").selectOption(ids.village);
  await page.getByRole("button", { name: "Create camp" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Camp updated." })).toBeVisible();
  expect(campPayloads).toHaveLength(1);
  expect(campPayloads[0]).toMatchObject({
    title: "Synthetic outreach camp",
    mandalId: ids.mandal,
    phcId: ids.phc,
    villageId: ids.village,
    assignedDoctorIds: []
  });
});
