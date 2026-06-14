export const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

export function getAnthropicHost(): string {
  try {
    const url = new URL(ANTHROPIC_BASE_URL);
    return url.hostname;
  } catch {
    return "api.anthropic.com";
  }
}

export function getAnthropicPort(): number {
  try {
    const url = new URL(ANTHROPIC_BASE_URL);
    if (url.port) {
      return parseInt(url.port, 10);
    }
    return url.protocol === "http:" ? 80 : 443;
  } catch {
    return 443;
  }
}

export function isAnthropicTls(): boolean {
  try {
    const url = new URL(ANTHROPIC_BASE_URL);
    return url.protocol === "https:";
  } catch {
    return true;
  }
}
