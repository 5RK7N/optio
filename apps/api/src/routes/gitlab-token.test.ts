import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRouteTestApp } from "../test-utils/build-route-test-app.js";
import type { FastifyInstance } from "fastify";
import { gitlabTokenRoutes } from "./gitlab-token.js";

// ─── Mocks ───

const mockRetrieveSecret = vi.fn();
const mockStoreSecret = vi.fn();
const mockListSecrets = vi.fn();

vi.mock("../services/secret-service.js", () => ({
  retrieveSecret: (...args: unknown[]) => mockRetrieveSecret(...args),
  storeSecret: (...args: unknown[]) => mockStoreSecret(...args),
  listSecrets: (...args: unknown[]) => mockListSecrets(...args),
}));

vi.mock("../services/oauth/index.js", () => ({
  isAuthDisabled: () => true,
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Setup ───

async function setupApp(): Promise<FastifyInstance> {
  return buildRouteTestApp(gitlabTokenRoutes, { user: null });
}

describe("GET /api/gitlab-token/status", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await setupApp();
  });

  it("returns missing when no token is stored", async () => {
    mockRetrieveSecret.mockImplementation((name) => {
      if (name === "GITLAB_HOST") return Promise.resolve("gitlab.internal.com");
      return Promise.reject(new Error("Secret not found"));
    });
    const res = await app.inject({ method: "GET", url: "/api/gitlab-token/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "missing", host: "gitlab.internal.com" });
  });

  it("returns valid and user info when token works", async () => {
    mockRetrieveSecret.mockImplementation((name) => {
      if (name === "GITLAB_TOKEN") return Promise.resolve("glpat-test123");
      return Promise.reject(new Error("Not found"));
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ username: "octocat", name: "The Octocat" }),
    });

    const res = await app.inject({ method: "GET", url: "/api/gitlab-token/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "valid",
      user: { login: "octocat", name: "The Octocat" },
      host: "gitlab.com",
    });
  });

  it("returns error when fetch returns non-200", async () => {
    mockRetrieveSecret.mockResolvedValue("glpat-expired");

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    const res = await app.inject({ method: "GET", url: "/api/gitlab-token/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "error",
      error: expect.stringContaining("401"),
    });
  });
});

describe("POST /api/gitlab-token/rotate", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await setupApp();
  });

  it("fails if payload is missing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/gitlab-token/rotate" });
    expect(res.statusCode).toBe(400);
  });

  it("returns false if token is invalid", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const res = await app.inject({
      method: "POST",
      url: "/api/gitlab-token/rotate",
      payload: { token: "bad-token" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("401"),
    });
    expect(mockStoreSecret).not.toHaveBeenCalled();
  });

  it("stores token and host if valid", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ username: "new_octocat", name: "New Octocat" }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/gitlab-token/rotate",
      payload: { token: "good-token", host: "gitlab.example.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      user: { login: "new_octocat", name: "New Octocat" },
    });

    expect(mockStoreSecret).toHaveBeenCalledWith("GITLAB_TOKEN", "good-token", "global");
    expect(mockStoreSecret).toHaveBeenCalledWith("GITLAB_HOST", "gitlab.example.com", "global");
  });
});
