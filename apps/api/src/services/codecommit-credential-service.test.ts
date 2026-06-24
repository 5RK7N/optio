import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseAwsCredentials, getCodeCommitCredentials } from "./codecommit-credential-service.js";

const mockRetrieveSecretWithFallback = vi.fn();
const mockLoggerDebug = vi.fn();

vi.mock("./secret-service.js", () => ({
  retrieveSecretWithFallback: (...args: unknown[]) => mockRetrieveSecretWithFallback(...args)
}));

vi.mock("../logger.js", () => ({
  logger: {
    debug: (...args: unknown[]) => mockLoggerDebug(...args)
  }
}));

describe("codecommit-credential-service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("parseAwsCredentials", () => {
    it("returns null for empty token", () => {
      expect(parseAwsCredentials("")).toBeNull();
    });

    it("returns null for workload-identity sentinel", () => {
      expect(parseAwsCredentials("workload-identity")).toBeNull();
    });

    it("returns null for invalid JSON string", () => {
      expect(parseAwsCredentials("{invalid json")).toBeNull();
    });

    it("returns null when parsed object lacks accessKeyId", () => {
      const token = JSON.stringify({ secretAccessKey: "secret", region: "us-east-1" });
      expect(parseAwsCredentials(token)).toBeNull();
    });

    it("returns null when parsed object lacks secretAccessKey", () => {
      const token = JSON.stringify({ accessKeyId: "key", region: "us-east-1" });
      expect(parseAwsCredentials(token)).toBeNull();
    });

    it("returns valid AwsCredentials when JSON is correct without sessionToken", () => {
      const creds = { accessKeyId: "key123", secretAccessKey: "secret123", region: "us-east-1" };
      const token = JSON.stringify(creds);
      expect(parseAwsCredentials(token)).toEqual(creds);
    });

    it("returns valid AwsCredentials when JSON is correct with sessionToken", () => {
      const creds = {
        accessKeyId: "key123",
        secretAccessKey: "secret123",
        sessionToken: "session123",
        region: "us-west-2",
      };
      const token = JSON.stringify(creds);
      expect(parseAwsCredentials(token)).toEqual(creds);
    });
  });

  describe("getCodeCommitCredentials", () => {
    it("should return workload-identity if no credentials are found in secrets or env", async () => {
      mockRetrieveSecretWithFallback.mockRejectedValue(new Error("Secret not found"));
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      const result = await getCodeCommitCredentials("workspace-123");
      expect(result).toBe("workload-identity");
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        { workspaceId: "workspace-123" },
        "No AWS credential secrets found, checking env"
      );
    });

    it("should resolve credentials from secrets", async () => {
      mockRetrieveSecretWithFallback.mockImplementation(async (key) => {
        if (key === "AWS_ACCESS_KEY_ID") return "secret_key_id";
        if (key === "AWS_SECRET_ACCESS_KEY") return "secret_access_key";
        if (key === "AWS_REGION") return "eu-west-1";
        throw new Error("Secret not found");
      });

      const result = await getCodeCommitCredentials();
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        accessKeyId: "secret_key_id",
        secretAccessKey: "secret_access_key",
        region: "eu-west-1"
      });
    });

    it("should fallback to environment variables if secrets are missing", async () => {
      mockRetrieveSecretWithFallback.mockRejectedValue(new Error("Secret not found"));
      process.env.AWS_ACCESS_KEY_ID = "env_key_id";
      process.env.AWS_SECRET_ACCESS_KEY = "env_access_key";
      process.env.AWS_SESSION_TOKEN = "env_session_token";
      process.env.AWS_REGION = "ap-south-1";

      const result = await getCodeCommitCredentials();
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        accessKeyId: "env_key_id",
        secretAccessKey: "env_access_key",
        sessionToken: "env_session_token",
        region: "ap-south-1"
      });
    });

    it("should use AWS_DEFAULT_REGION if AWS_REGION is missing", async () => {
      mockRetrieveSecretWithFallback.mockRejectedValue(new Error("Secret not found"));
      process.env.AWS_ACCESS_KEY_ID = "env_key_id";
      process.env.AWS_SECRET_ACCESS_KEY = "env_access_key";
      delete process.env.AWS_REGION;
      process.env.AWS_DEFAULT_REGION = "ca-central-1";

      const result = await getCodeCommitCredentials();
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        accessKeyId: "env_key_id",
        secretAccessKey: "env_access_key",
        region: "ca-central-1"
      });
    });

    it("should default region to us-east-1 if no region is provided", async () => {
      mockRetrieveSecretWithFallback.mockRejectedValue(new Error("Secret not found"));
      process.env.AWS_ACCESS_KEY_ID = "env_key_id";
      process.env.AWS_SECRET_ACCESS_KEY = "env_access_key";
      delete process.env.AWS_REGION;
      delete process.env.AWS_DEFAULT_REGION;

      const result = await getCodeCommitCredentials();
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        accessKeyId: "env_key_id",
        secretAccessKey: "env_access_key",
        region: "us-east-1"
      });
    });

    it("should resolve sessionToken from secrets if available", async () => {
      mockRetrieveSecretWithFallback.mockImplementation(async (key) => {
        if (key === "AWS_ACCESS_KEY_ID") return "secret_key_id";
        if (key === "AWS_SECRET_ACCESS_KEY") return "secret_access_key";
        if (key === "AWS_SESSION_TOKEN") return "secret_session_token";
        if (key === "AWS_REGION") return "eu-west-1";
        throw new Error("Secret not found");
      });

      const result = await getCodeCommitCredentials();
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        accessKeyId: "secret_key_id",
        secretAccessKey: "secret_access_key",
        sessionToken: "secret_session_token",
        region: "eu-west-1"
      });
    });
  });
});
