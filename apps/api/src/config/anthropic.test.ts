import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAnthropicHost, getAnthropicPort } from "./anthropic.js";
import { vi } from "vitest";

describe("anthropic config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default host and port when ANTHROPIC_BASE_URL is not set", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "");
    const config = await import("./anthropic.js");
    expect(config.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    expect(config.getAnthropicHost()).toBe("api.anthropic.com");
    expect(config.getAnthropicPort()).toBe(443);
  });

  it("parses custom https url without port", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://my-gateway.com/v1");
    const config = await import("./anthropic.js");
    expect(config.ANTHROPIC_BASE_URL).toBe("https://my-gateway.com/v1");
    expect(config.getAnthropicHost()).toBe("my-gateway.com");
    expect(config.getAnthropicPort()).toBe(443);
  });

  it("parses custom http url without port", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://my-gateway.com");
    const config = await import("./anthropic.js");
    expect(config.getAnthropicHost()).toBe("my-gateway.com");
    expect(config.getAnthropicPort()).toBe(80);
  });

  it("parses custom url with port", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://my-gateway.com:4000/anthropic");
    const config = await import("./anthropic.js");
    expect(config.getAnthropicHost()).toBe("my-gateway.com");
    expect(config.getAnthropicPort()).toBe(4000);
  });
});
