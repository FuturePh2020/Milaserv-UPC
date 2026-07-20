import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, ".fixture.json"), "utf-8")) as {
  username: string;
  password: string;
};

test("agent golden path: login -> start session -> generate lead -> call customer -> log outcome", async ({ page }) => {
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

  await page.getByRole("button", { name: "Call Customer" }).click();
  await expect(page.getByLabel("Call Result")).toBeVisible();

  await page.getByLabel("Call Result").selectOption("ANSWERED");
  await page.getByLabel("Outcome").selectOption("NOT_INTERESTED");
  await page.getByLabel("Notes").fill("Customer said they are not interested at this time.");
  await page.getByRole("button", { name: "Save Call Outcome" }).click();

  await expect(page.getByText("No lead currently assigned")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Completed Today/i).locator("..")).toContainText("1");
});
