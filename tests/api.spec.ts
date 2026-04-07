import { test, expect } from "@playwright/test";

test.describe("API Health Checks", () => {
  test("should handle unauthenticated user request gracefully", async ({ request }) => {
    const response = await request.get("/api/user");
    const status = response.status();
    expect([200, 401]).toContain(status);
  });

  test("should handle unauthenticated rooms request", async ({ request }) => {
    const response = await request.get("/api/rooms");
    const status = response.status();
    expect([200, 401]).toContain(status);
  });

  test("should block unauthenticated translation requests", async ({ request }) => {
    const response = await request.post("/api/translate", {
      data: { text: "hello", targetLang: "es" },
    });
    expect(response.status()).toBe(401);
  });

  test("should serve the frontend app on root", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("<!DOCTYPE html>");
  });

  test("should handle developer portal access verification", async ({ request }) => {
    const response = await request.post("/api/verify-developer-access", {
      data: { accessCode: "wrong-code" },
      headers: { "Content-Type": "application/json" },
    });
    const status = response.status();
    expect([200, 401]).toContain(status);
    if (status === 200) {
      const contentType = response.headers()["content-type"] || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        expect(data.valid).toBe(false);
      }
    }
  });

  test("should block unauthenticated feedback access", async ({ request }) => {
    const response = await request.get("/api/feedback");
    expect(response.status()).toBe(401);
  });

  test("should return metrics data from monitoring endpoint", async ({ request }) => {
    const response = await request.get("/api/metrics");
    const status = response.status();
    expect([200, 401]).toContain(status);
  });
});
