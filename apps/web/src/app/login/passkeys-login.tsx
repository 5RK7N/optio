import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import { startAuthentication, browserSupportsWebAuthnAutofill } from "@simplewebauthn/browser";
import { Loader2, KeyRound } from "lucide-react";

export function PasskeyLogin() {
  const [passkeysEnabled, setPasskeysEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authenticating, setAuthenticating] = useState(false);
  const [email, setEmail] = useState("");
  const [showEmailInput, setShowEmailInput] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const { enabled } = await api.getPasskeyStatus();
        setPasskeysEnabled(enabled);

        if (enabled && (await browserSupportsWebAuthnAutofill())) {
          // Attempt autofill
          try {
            const options = await api.generatePasskeyAuthenticationOptions();
            const response = await startAuthentication({
              optionsJSON: options,
              useBrowserAutofill: true,
            });
            await api.verifyPasskeyAuthentication(response);
            window.location.href = "/"; // redirect on success
          } catch (e) {
            // Ignore autofill errors, user might not interact with it
          }
        }
      } catch (err) {
        // Ignore or handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setAuthenticating(true);
      setError("");

      const options = await api.generatePasskeyAuthenticationOptions(email || undefined);
      const response = await startAuthentication({ optionsJSON: options });

      await api.verifyPasskeyAuthentication(response);
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message || "Failed to authenticate with passkey.");
    } finally {
      setAuthenticating(false);
    }
  };

  if (loading) return null;
  if (!passkeysEnabled) return null;

  return (
    <div className="space-y-3 mt-4">
      {error && (
        <div className="p-2 rounded bg-error/5 border border-error/20 text-error text-xs text-center">
          {error}
        </div>
      )}

      {showEmailInput ? (
        <form onSubmit={handleLogin} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="w-full px-3 py-2 rounded-md bg-bg border border-border/50 text-sm focus:outline-none focus:border-primary"
            autoComplete="username webauthn"
            required
          />
          <button
            type="submit"
            disabled={authenticating}
            className="flex items-center justify-center gap-3 w-full px-4 py-3 rounded-lg border border-border bg-bg-card text-sm font-medium hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            {authenticating ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <KeyRound className="w-5 h-5" />
            )}
            Sign in with Passkey
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowEmailInput(true)}
          className="flex items-center justify-center gap-3 w-full px-4 py-3 rounded-lg border border-border bg-bg-card text-sm font-medium hover:bg-bg-hover transition-colors"
        >
          <KeyRound className="w-5 h-5" />
          Sign in with Passkey
        </button>
      )}
    </div>
  );
}
