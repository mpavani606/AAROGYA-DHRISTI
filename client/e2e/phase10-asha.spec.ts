import { expect, test } from "./fixtures";

test("ASHA worker can register and follow up patients and record camp attendance", async ({ page }) => {
  const ids = {
    phc: "507f1f77bcf86cd799439012",
    village: "507f1f77bcf86cd799439013",
    camp: "507f1f77bcf86cd799439014",
    patient: "507f1f77bcf86cd799439015",
    participant: "507f1f77bcf86cd799439016"
  };
  const patients: Array<Record<string, unknown>> = [];
  const visits: Array<Record<string, unknown>> = [];
  let participantStatus = "registered";
  const camp = {
    _id: ids.camp,
    title: "Synthetic outreach camp",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 90_000_000).toISOString(),
    status: "open",
    mandal: { _id: "507f1f77bcf86cd799439011", name_en: "Synthetic mandal" },
    phc: { _id: ids.phc, name_en: "Synthetic PHC" },
    village: { _id: ids.village, name_en: "Synthetic village" },
    assignedDoctors: [],
    totals: { registered: "<5", attended: "<5", noShow: "<5" }
  };

  await page.route("**/api/v1/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ role: "asha_worker" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessToken: "test-asha-access-token",
        user: { id: "synthetic-asha", name: "Synthetic ASHA", role: "asha_worker" }
      })
    });
  });
  await page.route("**/api/v1/asha/dashboard", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      summary: { patients: patients.length, dueVisits: 0, visitsLast30Days: visits.length, pendingReferrals: 0 },
      phcs: [{ _id: ids.phc, name_en: "Synthetic PHC" }],
      villages: [{ _id: ids.village, name_en: "Synthetic village", phc: ids.phc, mandal: "507f1f77bcf86cd799439011" }]
    })
  }));
  await page.route("**/api/v1/asha/patients", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({
        name: "Synthetic patient",
        phone: "9000000044",
        ageYears: 46,
        phcId: ids.phc,
        villageId: ids.village,
        registrationConsent: true
      });
      const patient = { _id: ids.patient, name: "Synthetic patient", phone: "9000000044", ageYears: 46, phcId: ids.phc, villageId: ids.village };
      patients.push(patient);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ patient }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ patients }) });
  });
  await page.route("**/api/v1/community/camps", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ camps: [camp] })
  }));
  await page.route("**/api/v1/asha/patients/*/history", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ visits, screenings: [], followUps: [], referrals: [], camps: [] })
  }));
  await page.route("**/api/v1/asha/patients/*/visits", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const visit = { _id: "synthetic-visit", visitedAt: new Date().toISOString(), ...body };
    visits.push(visit);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ visit }) });
  });
  await page.route("**/api/v1/asha/patients/*/screening-consent", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ consent: { id: "synthetic-consent", purpose: "screening", granted: true } })
  }));
  await page.route("**/api/v1/asha/camps/*/participants", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ participants: [{ id: ids.participant, patientId: ids.patient, status: participantStatus }] })
  }));
  await page.route("**/api/v1/community/camps/*/participants", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ participant: { id: ids.participant, patientId: ids.patient, status: participantStatus } })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ participants: [{ id: ids.participant, patientId: ids.patient, status: participantStatus }] })
    });
  });
  await page.route("**/api/v1/community/camps/*/participants/*/attendance", async (route) => {
    const body = route.request().postDataJSON() as { status: string };
    participantStatus = body.status;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ participant: { id: ids.participant, patientId: ids.patient, status: participantStatus } })
    });
  });
  await page.route("**/api/v1/asha/activity-report", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ totalVisits: visits.length, upcomingFollowUps: 1, byOutcome: [] })
  }));

  await page.goto("/login?role=asha_worker");
  await page.locator('input[autocomplete="username"]').fill("synthetic-asha");
  await page.locator('input[type="password"]').fill("SyntheticPass123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/asha$/);
  await expect(page.getByRole("heading", { name: "ASHA worker portal" })).toBeVisible();

  await page.getByLabel("Patient name").fill("Synthetic patient");
  await page.getByLabel("Mobile number").fill("9000000044");
  await page.getByLabel("Age", { exact: true }).fill("46");
  await page.getByLabel("Patient agreed to registration and data storage").check();
  await page.getByRole("button", { name: "Save patient" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Patient registered." })).toBeVisible();

  await page.getByLabel("Visit outcome").selectOption("follow_up_needed");
  await page.getByLabel("Visit notes").fill("Synthetic follow-up note");
  await page.getByRole("button", { name: "Save visit" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Visit recorded." })).toBeVisible();

  const campsSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Health camps" }) });
  await campsSection.getByRole("combobox").nth(1).selectOption(ids.patient);
  await campsSection.getByLabel("Patient agreed to screening at this camp").check();
  await campsSection.getByRole("button", { name: "Register patient for camp" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Patient registered for the camp." })).toBeVisible();
  await page.getByRole("button", { name: "Mark attended" }).click();
  await expect(page.getByText("Synthetic patient · attended")).toBeVisible();

  await page.getByRole("button", { name: "Load report" }).click();
  await expect(page.getByText("Recorded visits:")).toContainText("1");
});
