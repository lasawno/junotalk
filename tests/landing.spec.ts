import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test("should display hero section with correct branding", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("badge-hero-tag")).toBeVisible();
    await expect(page.getByTestId("badge-hero-tag")).toContainText("A ⇄ 文");
    await expect(page.getByTestId("badge-hero-tag")).toContainText("Video + Voice + Text Translation");
    await expect(page.locator("h1")).toContainText("Video Calls with");
    await expect(page.locator("h1")).toContainText("Live Translated");
  });

  test("should have working Sign In and Get Started buttons", async ({ page }) => {
    await page.goto("/");
    const getStarted = page.getByTestId("button-get-started");
    await expect(getStarted).toBeVisible();
    await expect(getStarted).toContainText("Get Started Free");
    const signInLink = page.getByTestId("footer-link-signin");
    await expect(signInLink).toBeVisible();
  });

  test("should toggle features section", async ({ page }) => {
    await page.goto("/");
    const featuresBtn = page.getByTestId("button-learn-more");
    await expect(featuresBtn).toBeVisible();
    await featuresBtn.click();
    await expect(page.getByTestId("feature-video")).toBeVisible();
    await expect(page.getByTestId("feature-speech")).toBeVisible();
    await expect(page.getByTestId("feature-chat")).toBeVisible();
    await expect(page.getByTestId("feature-languages")).toBeVisible();
    await featuresBtn.click();
    await expect(page.getByTestId("feature-video")).not.toBeVisible();
  });

  test("should display QR code section", async ({ page }) => {
    await page.goto("/");
    const qrSection = page.locator("text=Scan to visit");
    await expect(qrSection).toBeVisible();
  });

  test("should have footer navigation links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("footer-link-how")).toBeVisible();
    await expect(page.getByTestId("footer-link-features")).toBeVisible();
    await expect(page.getByTestId("footer-link-signin")).toBeVisible();
    await expect(page.locator("text=2026 JunoTalk")).toBeVisible();
  });
});
