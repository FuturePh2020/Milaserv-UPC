import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, ".fixture.json"), "utf-8")) as {
  username: string;
  password: string;
};

test("agent golden path: login -> start session -> generate lead -> submit outcome", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(fixture.username);
  await page.getByLabel("Password").fill(fixture.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/agent\/dashboard/);
  await expect(page.getByRole("heading", { name: "Welcome, Playwright E2E Agent" })).toBeVisible();

  await page.getByRole("button", { name: "Start Session" }).click();
  await expect(page.getByRole("button", { name: "End Session" })).toBeVisible();
  await expect(page.getByText("AVAILABLE")).toBeVisible();

  await page.getByRole("button", { name: "Generate Lead" }).click();
  await expect(page.getByText("Playwright Test Lead")).toBeVisible({ timeout: 10_000 });

  await page.getByLabel("Notes").fill("Reached the customer, interested in the product.");
  const outcomeSelect = page.locator("select").filter({ hasText: "CONTACTED" });
  await outcomeSelect.selectOption("COMPLETED");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByText("No lead currently assigned")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Completed Today/i).locator("..")).toContainText("1");
});
