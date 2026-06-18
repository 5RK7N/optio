import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { db } from "../db/client.js";
import { users, passkeys } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";

// Using in-memory store for test purposes since redis.js path is wrong and redis is overkill for a challenge.
const challengeStore = new Map<string, string>();
const getRedisClient = () => ({
  setex: async (k: string, t: number, v: string) => {
    challengeStore.set(k, v);
  },
  get: async (k: string) => challengeStore.get(k),
  del: async (k: string) => {
    challengeStore.delete(k);
  },
});

// Relying Party constants
const rpName = "Optio";
// URL config
function getRpID() {
  if (process.env.PUBLIC_URL) {
    try {
      return new URL(process.env.PUBLIC_URL).hostname;
    } catch {}
  }
  if (process.env.PUBLIC_API_URL) {
    try {
      return new URL(process.env.PUBLIC_API_URL).hostname;
    } catch {}
  }
  return "localhost";
}

function getOrigin() {
  return process.env.PUBLIC_URL || "http://localhost:3100";
}

export function isPasskeysEnabled() {
  return process.env.OPTIO_ENABLE_PASSKEYS === "true";
}

export async function generatePasskeyRegistrationOptions(
  userId: string,
  email: string,
  displayName: string,
) {
  const userPasskeys = await db.select().from(passkeys).where(eq(passkeys.userId, userId));

  const options = await generateRegistrationOptions({
    rpName,
    rpID: getRpID(),
    userID: new Uint8Array(Buffer.from(userId)),
    userName: email,
    userDisplayName: displayName,
    attestationType: "none",
    excludeCredentials: userPasskeys.map((key) => ({
      id: key.id,
      transports: key.transports ? (key.transports.split(",") as any) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await db.update(users).set({ currentChallenge: options.challenge }).where(eq(users.id, userId));

  return options;
}

export async function verifyPasskeyRegistration(userId: string, body: any) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.currentChallenge) {
    throw new Error("No active challenge found for user");
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpID(),
    });
  } catch (error) {
    logger.error({ error, userId }, "Failed to verify passkey registration");
    throw error;
  }

  const { verified, registrationInfo } = verification;

  if (verified && registrationInfo) {
    const { credential } = registrationInfo;
    const credentialPublicKey = credential.publicKey;
    const credentialID = credential.id;
    const counter = registrationInfo.credential.counter || 0;
    const credentialDeviceType = registrationInfo.credentialDeviceType;
    const credentialBackedUp = registrationInfo.credentialBackedUp;

    // Clear the challenge
    await db.update(users).set({ currentChallenge: null }).where(eq(users.id, userId));

    // Save passkey
    await db.insert(passkeys).values({
      id: credentialID,
      userId,
      name: "Passkey",
      publicKey: Buffer.from(credentialPublicKey).toString("base64"),
      counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: body.response.transports ? body.response.transports.join(",") : null,
    });

    return { verified: true };
  }

  throw new Error("Passkey registration verification failed");
}

export async function generatePasskeyAuthenticationOptions(email?: string) {
  let userPasskeys: any[] = [];
  let user: any = null;

  if (email) {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    if (u) {
      user = u;
      userPasskeys = await db.select().from(passkeys).where(eq(passkeys.userId, u.id));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpID(),
    allowCredentials: userPasskeys.map((key) => ({
      id: key.id,
      transports: key.transports ? (key.transports.split(",") as any) : undefined,
    })),
    userVerification: "preferred",
  });

  const redis = getRedisClient();
  await redis.setex(`passkey_auth_challenge:${options.challenge}`, 300, "active");

  return options;
}

export async function verifyPasskeyAuthentication(body: any, email?: string) {
  const { id } = body;

  // Find the passkey
  const [passkey] = await db.select().from(passkeys).where(eq(passkeys.id, id));
  if (!passkey) {
    throw new Error("Passkey not found");
  }

  // Find the user
  const [user] = await db.select().from(users).where(eq(users.id, passkey.userId));
  if (!user) {
    throw new Error("User not found");
  }

  let challengeStr = "";
  try {
    const clientDataJSON = Buffer.from(body.response.clientDataJSON, "base64").toString("utf8");
    challengeStr = JSON.parse(clientDataJSON).challenge;
  } catch (err) {
    throw new Error("Invalid clientDataJSON");
  }

  const redis = getRedisClient();
  const isActive = await redis.get(`passkey_auth_challenge:${challengeStr}`);

  if (!isActive) {
    throw new Error("Challenge expired or invalid");
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      requireUserVerification: true,
      response: body,
      expectedChallenge: challengeStr,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpID(),
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64")),
        counter: passkey.counter,
        transports: passkey.transports ? (passkey.transports.split(",") as any) : undefined,
      },
    });
  } catch (error) {
    logger.error({ error, userId: user.id }, "Failed to verify passkey authentication");
    throw error;
  }

  const { verified, authenticationInfo } = verification;

  if (verified && authenticationInfo) {
    const { newCounter } = authenticationInfo;

    // Update counter
    await db.update(passkeys).set({ counter: newCounter }).where(eq(passkeys.id, passkey.id));

    // Clear challenge
    await redis.del(`passkey_auth_challenge:${challengeStr}`);

    return { verified: true, user };
  }

  throw new Error("Passkey authentication verification failed");
}

export async function listUserPasskeys(userId: string) {
  return await db
    .select({
      id: passkeys.id,
      name: passkeys.name,
      deviceType: passkeys.deviceType,
      createdAt: passkeys.createdAt,
      updatedAt: passkeys.updatedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
}

export async function deletePasskey(userId: string, passkeyId: string) {
  const [passkey] = await db.select().from(passkeys).where(eq(passkeys.id, passkeyId));

  if (!passkey) return false;
  if (passkey.userId !== userId) throw new Error("Unauthorized");

  await db.delete(passkeys).where(eq(passkeys.id, passkeyId));
  return true;
}
