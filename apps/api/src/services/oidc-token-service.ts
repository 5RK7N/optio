import { retrieveSecret, storeSecret, deleteSecret } from "./secret-service.js";
import { getOAuthProvider } from "./oauth/index.js";
import { GenericOIDCProvider } from "./oauth/oidc.js";
import { logger } from "../logger.js";

const refreshLocks = new Map<string, Promise<string>>();
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000; // Refresh 10 mins before expiry

export async function storeUserOIDCTokens(
  userId: string,
  tokens: { accessToken: string; refreshToken?: string; idToken?: string; expiresIn?: number },
): Promise<void> {
  const promises: Promise<any>[] = [
    storeSecret("OIDC_USER_ACCESS_TOKEN", tokens.accessToken, "user", undefined, userId),
  ];

  if (tokens.refreshToken) {
    promises.push(
      storeSecret("OIDC_USER_REFRESH_TOKEN", tokens.refreshToken, "user", undefined, userId),
    );
  }

  if (tokens.idToken) {
    promises.push(storeSecret("OIDC_USER_ID_TOKEN", tokens.idToken, "user", undefined, userId));
  }

  if (tokens.expiresIn) {
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
    promises.push(storeSecret("OIDC_USER_TOKEN_EXPIRES_AT", expiresAt, "user", undefined, userId));
  }

  await Promise.all(promises);
}

export async function deleteUserOIDCTokens(userId: string): Promise<void> {
  await Promise.all([
    deleteSecret("OIDC_USER_ACCESS_TOKEN", "user", undefined, userId).catch(() => {}),
    deleteSecret("OIDC_USER_REFRESH_TOKEN", "user", undefined, userId).catch(() => {}),
    deleteSecret("OIDC_USER_ID_TOKEN", "user", undefined, userId).catch(() => {}),
    deleteSecret("OIDC_USER_TOKEN_EXPIRES_AT", "user", undefined, userId).catch(() => {}),
  ]);
}

export async function getUserOIDCIdToken(userId: string): Promise<string | null> {
  try {
    return await retrieveSecret("OIDC_USER_ID_TOKEN", "user", undefined, userId);
  } catch {
    return null;
  }
}

export async function getValidOIDCAccessToken(userId: string): Promise<string | null> {
  try {
    const accessToken = await retrieveSecret("OIDC_USER_ACCESS_TOKEN", "user", undefined, userId);
    let expiresAt: string | null = null;
    try {
      expiresAt = await retrieveSecret("OIDC_USER_TOKEN_EXPIRES_AT", "user", undefined, userId);
    } catch {
      // No expiry stored, assume it's valid if we have it
      return accessToken;
    }

    if (!expiresAt) return accessToken;

    const expiryTime = new Date(expiresAt).getTime();
    if (Date.now() < expiryTime - TOKEN_REFRESH_BUFFER_MS) {
      return accessToken;
    }

    return refreshOIDCTokens(userId);
  } catch (err) {
    return null;
  }
}

async function refreshOIDCTokens(userId: string): Promise<string | null> {
  const existing = refreshLocks.get(userId);
  if (existing) return existing;

  const refreshPromise = doRefreshOIDCTokens(userId);
  refreshLocks.set(userId, refreshPromise as any);
  try {
    return await refreshPromise;
  } finally {
    refreshLocks.delete(userId);
  }
}

async function doRefreshOIDCTokens(userId: string): Promise<string | null> {
  try {
    const refreshToken = await retrieveSecret("OIDC_USER_REFRESH_TOKEN", "user", undefined, userId);
    const provider = getOAuthProvider("oidc");

    if (!provider || provider.name !== "oidc" || !provider.refreshTokens) {
      throw new Error("OIDC provider not configured or does not support refresh");
    }

    await provider.prepare?.();
    const tokens = await provider.refreshTokens(refreshToken);

    await storeUserOIDCTokens(userId, tokens);
    return tokens.accessToken;
  } catch (err) {
    logger.warn({ userId, err }, "Failed to refresh OIDC tokens");
    await deleteUserOIDCTokens(userId);
    return null;
  }
}
