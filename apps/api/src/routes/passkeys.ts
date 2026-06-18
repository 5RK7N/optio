import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  isPasskeysEnabled,
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
  listUserPasskeys,
  deletePasskey,
} from "../services/passkeys-service.js";
import { createSessionToken } from "../services/session-service.js";
import { SESSION_COOKIE_NAME } from "../plugins/auth.js";
import { ErrorResponseSchema } from "../schemas/common.js";
const OkResponseSchema = z.object({ ok: z.boolean() });

const PasskeyStatusResponseSchema = z.object({
  enabled: z.boolean(),
});

export async function passkeysRoutes(rawApp: FastifyInstance) {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/auth/passkey/status",
    {
      schema: {
        operationId: "getPasskeyStatus",
        summary: "Check if passkeys are enabled",
        tags: ["Auth & Sessions"],
        security: [],
        response: { 200: PasskeyStatusResponseSchema },
      },
    },
    async (_req, reply) => {
      reply.send({ enabled: isPasskeysEnabled() });
    },
  );

  app.post(
    "/api/auth/passkey/register/generate-options",
    {
      schema: {
        operationId: "generatePasskeyRegistrationOptions",
        summary: "Generate passkey registration options",
        tags: ["Auth & Sessions"],
        response: {
          200: z.any(),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isPasskeysEnabled()) {
        return reply.status(403).send({ error: "Passkeys are not enabled" });
      }
      if (!req.user) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const options = await generatePasskeyRegistrationOptions(
        req.user.id,
        req.user.email,
        req.user.displayName,
      );
      reply.send(options);
    },
  );

  app.post(
    "/api/auth/passkey/register/verify",
    {
      schema: {
        operationId: "verifyPasskeyRegistration",
        summary: "Verify passkey registration",
        tags: ["Auth & Sessions"],
        body: z.any(),
        response: {
          200: z.object({ verified: z.boolean() }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isPasskeysEnabled()) {
        return reply.status(403).send({ error: "Passkeys are not enabled" });
      }
      if (!req.user) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      try {
        const result = await verifyPasskeyRegistration(req.user.id, req.body);
        reply.send(result);
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    },
  );

  app.post(
    "/api/auth/passkey/login/generate-options",
    {
      schema: {
        operationId: "generatePasskeyAuthenticationOptions",
        summary: "Generate passkey authentication options",
        tags: ["Auth & Sessions"],
        security: [],
        body: z.object({ email: z.string().optional() }).optional(),
        response: {
          200: z.any(),
          403: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isPasskeysEnabled()) {
        return reply.status(403).send({ error: "Passkeys are not enabled" });
      }

      const options = await generatePasskeyAuthenticationOptions(req.body?.email);
      reply.send(options);
    },
  );

  app.post(
    "/api/auth/passkey/login/verify",
    {
      schema: {
        operationId: "verifyPasskeyAuthentication",
        summary: "Verify passkey authentication and login",
        tags: ["Auth & Sessions"],
        security: [],
        body: z.any(),
        response: {
          200: z.object({ token: z.string() }),
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isPasskeysEnabled()) {
        return reply.status(403).send({ error: "Passkeys are not enabled" });
      }

      try {
        /* eslint-disable no-restricted-syntax */
        const bodyAny = req.body as any;
        /* eslint-enable no-restricted-syntax */
        const { verified, user } = await verifyPasskeyAuthentication(
          bodyAny,
          bodyAny.email || undefined,
        );

        if (verified && user) {
          const sessionToken = await createSessionToken(user.id);
          const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
          reply.header(
            "Set-Cookie",
            `${SESSION_COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=2592000`, // 30 days
          );
          reply.send({ token: sessionToken });
        } else {
          reply.status(400).send({ error: "Verification failed" });
        }
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    },
  );

  app.get(
    "/api/auth/passkeys",
    {
      schema: {
        operationId: "listPasskeys",
        summary: "List user passkeys",
        tags: ["Auth & Sessions"],
        response: {
          200: z.object({ passkeys: z.array(z.any()) }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isPasskeysEnabled()) {
        return reply.status(403).send({ error: "Passkeys are not enabled" });
      }
      if (!req.user) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const passkeysList = await listUserPasskeys(req.user.id);
      reply.send({ passkeys: passkeysList });
    },
  );

  app.delete(
    "/api/auth/passkeys/:id",
    {
      schema: {
        operationId: "deletePasskey",
        summary: "Delete a passkey",
        tags: ["Auth & Sessions"],
        params: z.object({ id: z.string() }),
        response: {
          200: OkResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isPasskeysEnabled()) {
        return reply.status(403).send({ error: "Passkeys are not enabled" });
      }
      if (!req.user) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const deleted = await deletePasskey(req.user.id, req.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "Passkey not found" });
      }

      reply.send({ ok: true });
    },
  );
}
