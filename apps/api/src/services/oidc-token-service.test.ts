import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  storeUserOIDCTokens,
  getValidOIDCAccessToken,
  deleteUserOIDCTokens,
  getUserOIDCIdToken,
} from "./oidc-token-service.js";

// Mock the secret service
const mockSecrets = new Map<string, string>();
vi.mock("./secret-service.js", () => ({
  storeSecret: vi.fn(
    async (name: string, value: string, scope: string, _wsId: any, userId: string) => {
      mockSecrets.set(`${userId}:${name}`, value);
    },
  ),
  retrieveSecret: vi.fn(async (name: string, scope: string, _wsId: any, userId: string) => {
    const val = mockSecrets.get(`${userId}:${name}`);
    if (val === undefined) throw new Error("Not found");
    return val;
  }),
  deleteSecret: vi.fn(async (name: string, scope: string, _wsId: any, userId: string) => {
    mockSecrets.delete(`${userId}:${name}`);
  }),
}));

// Mock the OIDC provider
const mockRefreshTokens = vi.fn();
const mockPrepare = vi.fn();
vi.mock("./oauth/index.js", () => ({
  getOAuthProvider: vi.fn(() => ({
    name: "oidc",
    prepare: mockPrepare,
    refreshTokens: mockRefreshTokens,
  })),
}));

describe("oidc-token-service", () => {
  const userId = "user-123";

  beforeEach(() => {
    vi.clearAllMocks();
    mockSecrets.clear();
    mockRefreshTokens.mockReset();
    mockPrepare.mockReset();
  });

  describe("storeUserOIDCTokens()", () => {
    it("stores access, refresh, and id tokens", async () => {
      await storeUserOIDCTokens(userId, {
        accessToken: "at-1",
        refreshToken: "rt-1",
        idToken: "it-1",
        expiresIn: 3600,
      });

      expect(mockSecrets.get(`${userId}:OIDC_USER_ACCESS_TOKEN`)).toBe("at-1");
      expect(mockSecrets.get(`${userId}:OIDC_USER_REFRESH_TOKEN`)).toBe("rt-1");
      expect(mockSecrets.get(`${userId}:OIDC_USER_ID_TOKEN`)).toBe("it-1");
      expect(mockSecrets.get(`${userId}:OIDC_USER_TOKEN_EXPIRES_AT`)).toBeDefined();
    });

    it("works without optional tokens", async () => {
      await storeUserOIDCTokens(userId, {
        accessToken: "at-1",
      });

      expect(mockSecrets.get(`${userId}:OIDC_USER_ACCESS_TOKEN`)).toBe("at-1");
      expect(mockSecrets.get(`${userId}:OIDC_USER_REFRESH_TOKEN`)).toBeUndefined();
    });
  });

  describe("getUserOIDCIdToken()", () => {
    it("retrieves the id token", async () => {
      mockSecrets.set(`${userId}:OIDC_USER_ID_TOKEN`, "it-123");
      const token = await getUserOIDCIdToken(userId);
      expect(token).toBe("it-123");
    });

    it("returns null if not found", async () => {
      const token = await getUserOIDCIdToken(userId);
      expect(token).toBeNull();
    });
  });

  describe("getValidOIDCAccessToken()", () => {
    it("returns access token if not expired", async () => {
      mockSecrets.set(`${userId}:OIDC_USER_ACCESS_TOKEN`, "at-123");
      // Expire in 1 hour
      const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
      mockSecrets.set(`${userId}:OIDC_USER_TOKEN_EXPIRES_AT`, expiresAt);

      const token = await getValidOIDCAccessToken(userId);
      expect(token).toBe("at-123");
      expect(mockRefreshTokens).not.toHaveBeenCalled();
    });

    it("refreshes token if expired or near expiry", async () => {
      mockSecrets.set(`${userId}:OIDC_USER_ACCESS_TOKEN`, "old-at");
      mockSecrets.set(`${userId}:OIDC_USER_REFRESH_TOKEN`, "rt-123");
      // Expired 5 mins ago
      const expiresAt = new Date(Date.now() - 300 * 1000).toISOString();
      mockSecrets.set(`${userId}:OIDC_USER_TOKEN_EXPIRES_AT`, expiresAt);

      mockRefreshTokens.mockResolvedValue({
        accessToken: "new-at",
        refreshToken: "new-rt",
        expiresIn: 3600,
      });

      const token = await getValidOIDCAccessToken(userId);
      expect(token).toBe("new-at");
      expect(mockRefreshTokens).toHaveBeenCalledWith("rt-123");
      expect(mockSecrets.get(`${userId}:OIDC_USER_ACCESS_TOKEN`)).toBe("new-at");
    });

    it("returns null if refresh fails", async () => {
      mockSecrets.set(`${userId}:OIDC_USER_ACCESS_TOKEN`, "old-at");
      mockSecrets.set(`${userId}:OIDC_USER_REFRESH_TOKEN`, "rt-123");
      mockSecrets.set(`${userId}:OIDC_USER_TOKEN_EXPIRES_AT`, new Date(0).toISOString());

      mockRefreshTokens.mockRejectedValue(new Error("Refresh failed"));

      const token = await getValidOIDCAccessToken(userId);
      expect(token).toBeNull();
      // Should have cleared tokens
      expect(mockSecrets.has(`${userId}:OIDC_USER_ACCESS_TOKEN`)).toBe(false);
    });
  });

  describe("deleteUserOIDCTokens()", () => {
    it("clears all stored tokens", async () => {
      mockSecrets.set(`${userId}:OIDC_USER_ACCESS_TOKEN`, "at");
      mockSecrets.set(`${userId}:OIDC_USER_REFRESH_TOKEN`, "rt");

      await deleteUserOIDCTokens(userId);

      expect(mockSecrets.size).toBe(0);
    });
  });
});
