import { describe, it, expect, vi, afterEach } from "vitest";

describe("passkeys-service", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is enabled by default", async () => {
    delete process.env.OPTIO_ENABLE_PASSKEYS;
    const { isPasskeysEnabled } = await import("./passkeys-service.js");
    expect(isPasskeysEnabled()).toBe(true);
  });

  it("is disabled when environment variable is set to 'false'", async () => {
    process.env.OPTIO_ENABLE_PASSKEYS = "false";
    // We need to re-import or use a fresh instance if it was cached,
    // but here it's a simple function call reading process.env
    const { isPasskeysEnabled } = await import("./passkeys-service.js");
    expect(isPasskeysEnabled()).toBe(false);
  });

  it("is enabled when environment variable is set to 'true'", async () => {
    process.env.OPTIO_ENABLE_PASSKEYS = "true";
    const { isPasskeysEnabled } = await import("./passkeys-service.js");
    expect(isPasskeysEnabled()).toBe(true);
  });
});
