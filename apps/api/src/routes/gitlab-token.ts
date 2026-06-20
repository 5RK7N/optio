import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { retrieveSecret, storeSecret } from "../services/secret-service.js";
import { isAuthDisabled } from "../services/oauth/index.js";
import { ErrorResponseSchema } from "../schemas/common.js";

const rotateTokenSchema = z
  .object({
    token: z.string().min(1).describe("New GitLab personal access token"),
    host: z.string().optional().describe("GitLab Host, defaults to gitlab.com"),
  })
  .describe("Body for rotating the stored GITLAB_TOKEN secret");

const GitLabTokenStatusResponseSchema = z
  .object({
    status: z.string().describe("`valid` | `missing` | `error`"),
    host: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
    user: z.object({ login: z.string(), name: z.string() }).optional(),
  })
  .describe("Stored GitLab token status + authenticated user info");

const GitLabTokenRotateResponseSchema = z
  .object({
    success: z.boolean(),
    user: z.object({ login: z.string(), name: z.string() }).optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .describe("Result of rotating the stored GitLab token");

/** Rate limit: 10 requests per minute per IP. */
const RATE_LIMIT = {
  max: 10,
  timeWindow: "1 minute",
};

const requireAdminWhenAuthenticated = async (req: FastifyRequest, reply: FastifyReply) => {
  if (isAuthDisabled()) return;
  if (!req.user) return;
  if (req.user.workspaceRole !== "admin") {
    return reply.status(403).send({ error: "Admin role required" });
  }
};

export async function gitlabTokenRoutes(rawApp: FastifyInstance) {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/gitlab-token/status",
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        operationId: "getGitLabTokenStatus",
        summary: "Check stored GitLab token status",
        description:
          "Validate the stored GITLAB_TOKEN secret against the GitLab API. " +
          "Returns `missing` / `valid` / `error`.",
        tags: ["Auth & Sessions"],
        response: { 200: GitLabTokenStatusResponseSchema },
      },
    },
    async (_req, reply) => {
      let token: string | null = null;
      let host: string = "gitlab.com";

      try {
        const storedHost = await retrieveSecret("GITLAB_HOST");
        if (storedHost) host = storedHost;
      } catch {
        // default to gitlab.com
      }

      try {
        token = await retrieveSecret("GITLAB_TOKEN");
      } catch {
        /* no token stored */
      }

      if (!token) {
        return reply.send({
          status: "missing",
          host,
          message: "No GitLab token configured.",
        });
      }

      try {
        const res = await fetch(`https://${host}/api/v4/user`, {
          headers: { "PRIVATE-TOKEN": token, "User-Agent": "Optio" },
        });

        if (res.ok) {
          const user = (await res.json()) as { username: string; name: string };
          return reply.send({
            status: "valid",
            host,
            user: { login: user.username, name: user.name },
          });
        }

        return reply.send({
          status: "error",
          host,
          error: `GitLab returned ${res.status} — token may be expired or revoked`,
          message: "Replace your GitLab token to restore integration features.",
        });
      } catch (err) {
        app.log.error(err, "GitLab token validation failed");
        return reply.send({
          status: "error",
          host,
          error: "Could not reach GitLab API to validate token",
        });
      }
    },
  );

  app.post(
    "/api/gitlab-token/rotate",
    {
      config: { rateLimit: RATE_LIMIT },
      preHandler: [requireAdminWhenAuthenticated],
      schema: {
        operationId: "rotateGitLabToken",
        summary: "Rotate the stored GitLab token",
        description:
          "Validate a new GitLab personal access token against the GitLab API " +
          "and replace the stored GITLAB_TOKEN secret. If validation fails, " +
          "the existing token is NOT replaced. Rate limited to 10/minute per IP. " +
          "Requires admin role post-setup.",
        tags: ["Auth & Sessions"],
        body: rotateTokenSchema,
        response: {
          200: GitLabTokenRotateResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { token } = req.body;
      const host = req.body.host || "gitlab.com";

      try {
        const res = await fetch(`https://${host}/api/v4/user`, {
          headers: { "PRIVATE-TOKEN": token.trim(), "User-Agent": "Optio" },
        });

        if (!res.ok) {
          return reply.send({
            success: false,
            error: `GitLab returned ${res.status} — token is invalid or expired`,
          });
        }

        const user = (await res.json()) as { username: string; name: string };

        await storeSecret("GITLAB_TOKEN", token.trim(), "global");
        if (host && host !== "gitlab.com") {
          await storeSecret("GITLAB_HOST", host.trim(), "global");
        } else {
          // If returning to default gitlab.com, overwrite any old custom host to prevent stale host failures
          await storeSecret("GITLAB_HOST", "gitlab.com", "global");
        }

        return reply.send({
          success: true,
          user: { login: user.username, name: user.name },
          message: "GitLab token replaced successfully.",
        });
      } catch (err) {
        app.log.error(err, "GitLab token rotation failed");
        return reply.send({
          success: false,
          error: "Could not validate token — GitLab API may be unreachable",
        });
      }
    },
  );
}
