import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  users: { id: "users.id", currentChallenge: "users.currentChallenge" },
  passkeys: { userId: "passkeys.userId", id: "passkeys.id", name: "passkeys.name" },
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import { db } from "../db/client.js";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { isPasskeysEnabled, verifyPasskeyRegistration } from "./passkeys-service.js";

describe("passkeys-service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is enabled by default", async () => {
    delete process.env.OPTIO_ENABLE_PASSKEYS;
    expect(isPasskeysEnabled()).toBe(true);
  });

  it("is disabled when environment variable is set to 'false'", async () => {
    process.env.OPTIO_ENABLE_PASSKEYS = "false";
    expect(isPasskeysEnabled()).toBe(false);
  });

  describe("verifyPasskeyRegistration", () => {
    const userId = "user-123";
    const mockResponse = { id: "credential-id", response: { transports: ["usb"] } };

    it("saves passkey with a custom name", async () => {
      // Mock user lookup
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: userId, currentChallenge: "challenge-123" }]),
        }),
      });

      // Mock verification success
      (verifyRegistrationResponse as any).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: "credential-id", publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
          credentialDeviceType: "single_device",
          credentialBackedUp: true,
        },
      });

      // Mock update and insert
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      });
      const insertValuesSpy = vi.fn().mockResolvedValue({});
      (db.insert as any).mockReturnValue({
        values: insertValuesSpy,
      });

      await verifyPasskeyRegistration(userId, {
        name: "My MacBook",
        response: mockResponse,
      });

      expect(insertValuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My MacBook",
          id: "credential-id",
        }),
      );
    });

    it("falls back to 'Passkey' if no name is provided (backward compat)", async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: userId, currentChallenge: "challenge-123" }]),
        }),
      });

      (verifyRegistrationResponse as any).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: "credential-id", publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
          credentialDeviceType: "single_device",
          credentialBackedUp: true,
        },
      });

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      });
      const insertValuesSpy = vi.fn().mockResolvedValue({});
      (db.insert as any).mockReturnValue({
        values: insertValuesSpy,
      });

      // Pass the response directly (legacy style)
      await verifyPasskeyRegistration(userId, mockResponse);

      expect(insertValuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Passkey",
        }),
      );
    });
  });
});
