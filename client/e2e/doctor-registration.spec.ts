import { expect, test } from "./fixtures";

test("doctor registration collects credentials and routes to doctor sign-in", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/auth/doctor/register", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ message: "Doctor account created." })
    });
  });

  await page.goto("/doctor/register");
  await page.getByLabel("Full name").fill("Synthetic Doctor");
  await page.getByLabel("Username").fill("synthetic.doctor");
  await page.getByLabel("Email").fill("synthetic.doctor@example.test");
  await page.getByLabel("Mobile number").fill("+919876543210");
  await page.getByLabel("Professional registration number").fill("REG-SYNTHETIC-01");
  await page.getByLabel("Medical council or registration authority").fill("Synthetic Medical Council");
  await page.getByLabel("Specialty").fill("Oral Medicine");
  await page.getByLabel("Hospital name").fill("Synthetic Hospital");
  await page.getByLabel("Highest qualification").fill("Dental Degree");
  await page.getByLabel("Years of experience").fill("8");
  await page.locator('input[autocomplete="new-password"]').nth(0).fill("Synthetic-Doctor-Pass-2026!");
  await page.locator('input[autocomplete="new-password"]').nth(1).fill("Different-Password-2026!");
  await page.getByRole("button", { name: "Doctor registration" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  expect(submitted).toBeUndefined();
  await page.locator('input[autocomplete="new-password"]').nth(1).fill("Synthetic-Doctor-Pass-2026!");
  await page.getByRole("button", { name: "Doctor registration" }).click();

  await expect(page).toHaveURL(/\/doctor\/login$/);
  await expect(page.getByText("Registration created. Sign in with your email, username, or mobile number and password to continue professional verification.")).toBeVisible();
  expect(submitted).toMatchObject({
    name: "Synthetic Doctor",
    username: "synthetic.doctor",
    email: "synthetic.doctor@example.test",
    registrationNo: "REG-SYNTHETIC-01",
    registrationAuthority: "Synthetic Medical Council",
    specialty: "Oral Medicine",
    hospitalName: "Synthetic Hospital",
    qualification: "Dental Degree",
    experienceYears: 8
  });
  expect(submitted).not.toHaveProperty("confirmPassword");
});

test("doctor registration reports when the API cannot be reached", async ({ page }) => {
  await page.route("**/api/v1/auth/doctor/register", (route) => route.abort());

  await page.goto("/doctor/register");
  await page.getByLabel("Full name").fill("Synthetic Doctor");
  await page.getByLabel("Username").fill("synthetic.doctor");
  await page.getByLabel("Email").fill("synthetic.doctor@example.test");
  await page.getByLabel("Mobile number").fill("+919876543210");
  await page.getByLabel("Professional registration number").fill("REG-SYNTHETIC-01");
  await page.getByLabel("Medical council or registration authority").fill("Synthetic Medical Council");
  await page.getByLabel("Specialty").fill("Oral Medicine");
  await page.getByLabel("Hospital name").fill("Synthetic Hospital");
  await page.getByLabel("Highest qualification").fill("Dental Degree");
  await page.getByLabel("Years of experience").fill("8");
  await page.locator('input[autocomplete="new-password"]').nth(0).fill("Synthetic-Doctor-Pass-2026!");
  await page.locator('input[autocomplete="new-password"]').nth(1).fill("Synthetic-Doctor-Pass-2026!");
  await page.getByRole("button", { name: "Doctor registration" }).click();

  await expect(page.getByRole("alert")).toHaveText("Could not reach the registration server. Check that the backend is running and open the app using its configured local address.");
});

test("doctor registration identifies which unique field conflicts", async ({ page }) => {
  await page.route("**/api/v1/auth/doctor/register", (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "DOCTOR_REGISTRATION_CONFLICT", field: "phone", message_en: "This mobile number is already associated with an account." } })
  }));

  await page.goto("/doctor/register");
  await page.getByLabel("Full name").fill("Synthetic Doctor");
  await page.getByLabel("Username").fill("synthetic.doctor");
  await page.getByLabel("Email").fill("synthetic.doctor@example.test");
  await page.getByLabel("Mobile number").fill("+919876543210");
  await page.getByLabel("Professional registration number").fill("REG-SYNTHETIC-01");
  await page.getByLabel("Medical council or registration authority").fill("Synthetic Medical Council");
  await page.getByLabel("Specialty").fill("Oral Medicine");
  await page.getByLabel("Hospital name").fill("Synthetic Hospital");
  await page.getByLabel("Highest qualification").fill("Dental Degree");
  await page.getByLabel("Years of experience").fill("8");
  await page.locator('input[autocomplete="new-password"]').nth(0).fill("Synthetic-Doctor-Pass-2026!");
  await page.locator('input[autocomplete="new-password"]').nth(1).fill("Synthetic-Doctor-Pass-2026!");
  await page.getByRole("button", { name: "Doctor registration" }).click();

  await expect(page.getByRole("alert")).toHaveText("This mobile number is already associated with an account.");
  await expect(page).toHaveURL(/\/doctor\/register$/);
});
