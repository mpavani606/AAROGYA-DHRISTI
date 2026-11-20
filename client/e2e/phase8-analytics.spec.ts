import { expect, test } from "./fixtures";

const analyticsResponse = {
  scope: "system_admin",
  filters: { from: null, to: null, page: 1, pageSize: 12 },
  totals: {
    registeredPatients: 8,
    doctors: { total: 3, active: 2, verified: 2, pendingVerification: 1 },
    activeHospitals: 2,
    screenings: { total: 6, pendingReview: 2, completedReview: 4, byStatus: { in_review: 2, clinician_reviewed: 4 } },
    referrals: { total: 2, completed: 1, byStatus: { requested: 1, completed: 1 } },
    followUps: { total: 3, completed: 2, byStatus: { scheduled: 1, completed: 2 } },
    appointments: { total: 4, upcoming: 2, byStatus: { confirmed: 2, attended: 2 } }
  },
  monthlyTrend: [{ _id: "2026-11", screenings: 6, reviews: 4, referrals: 2 }],
  pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 }
};

test("admin analytics loads scoped aggregates, filters, monitoring, health, and reports", async ({ page }) => {
  const queries: string[] = [];
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "phase8-test-token");
    sessionStorage.setItem("aarogya-auth-token", "phase8-test-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-system-admin", name: "Synthetic System Admin", role: "system_admin" })
  }));
  await page.route("**/api/v1/geo/mandals", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ mandals: [{ _id: "507f1f77bcf86cd799439011", name: "Synthetic Mandal", name_en: "Synthetic Mandal" }] })
  }));
  await page.route("**/api/v1/admin/hospitals**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ hospitals: [] })
  }));
  await page.route("**/api/v1/analytics/overview**", (route) => {
    queries.push(new URL(route.request().url()).search);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analyticsResponse) });
  });
  await page.route("**/api/v1/ai-monitoring**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      mode: "local_deterministic_demo",
      clinicalValidated: false,
      period: { from: "2026-11-10T00:00:00.000Z", to: "2026-11-11T00:00:00.000Z" },
      totals: { completed: 5, failed: 1, unavailable: 0, averageDurationMs: 21, maxDurationMs: 35 },
      modelVersions: [{ version: "1.0.0", requests: 6 }],
      dailyMetrics: [{ date: "2026-11-11", completed: 5, failed: 1, unavailable: 0, averageDurationMs: 21 }],
      recentErrors: []
    })
  }));
  await page.route("**/api/v1/system-health", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      checkedAt: "2026-11-11T00:00:00.000Z",
      api: { status: "available", requestMetrics: { windowMinutes: 60, totalRequests: 10, errorRequests: 1, serverErrors: 0 } },
      database: { status: "healthy", readyState: 1 },
      mediaStorage: { mode: "local", status: "available" },
      aiScreening: { status: "available", mode: "local_deterministic_demo", clinicalValidated: false },
      notifications: { status: "available", periodHours: 24, queued: 1, failed: 0, sent: 4 },
      backgroundJobs: [{ name: "sla-escalations", schedule: "0 * * * *", state: "scheduled", runCount: 1 }],
      process: { scope: "current_api_process", uptimeSeconds: 100 }
    })
  }));
  await page.route("**/api/v1/operational-reports**", (route) => route.fulfill({
    status: 200,
    contentType: "text/csv",
    headers: { "content-disposition": 'attachment; filename="analytics-operations.csv"' },
    body: "metric,value\r\nscreenings.total,6"
  }));

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Operational analytics" })).toBeVisible();
  await expect(page.getByText("Local deterministic demonstration only", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
  await expect(page.getByLabel("Mandal")).toBeVisible();
  await expect(page.getByLabel("Mandal").locator("option", { hasText: "Synthetic Mandal" })).toHaveCount(1);
  await expect(page.getByText("sla-escalations")).toBeVisible();

  await page.getByLabel("Screening status").selectOption("in_review");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => queries.length).toBeGreaterThan(1);
  expect(queries.at(-1)).toContain("screeningStatus=in_review");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("analytics-operations.csv");
});
