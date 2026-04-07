import { test, expect } from "@playwright/test";

test.describe("Navigation & Routing", () => {
  test("should show landing page for unauthenticated users", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("badge-hero-tag")).toBeVisible();
  });

  test("should load developer portal page", async ({ page }) => {
    await page.goto("/developer");
    await page.waitForLoadState("networkidle");
    const portalContent = page.locator("text=Developer Portal")
      .or(page.locator("text=Access Code"))
      .or(page.locator("text=Enter"))
      .or(page.getByTestId("badge-hero-tag"));
    await expect(portalContent.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have responsive mobile viewport", async ({ page }) => {
    await page.goto("/");
    const viewport = page.viewportSize();
    expect(viewport?.width).toBeLessThanOrEqual(400);
    await expect(page.getByTestId("badge-hero-tag")).toBeVisible();
  });

  test("should load settings page (redirects if unauthenticated)", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForTimeout(2000);
    const hasSettings = await page.locator("text=Settings").isVisible().catch(() => false);
    const hasLanding = await page.getByTestId("badge-hero-tag").isVisible().catch(() => false);
    expect(hasSettings || hasLanding).toBe(true);
  });
});
