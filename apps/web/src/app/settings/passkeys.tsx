import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import { startRegistration } from "@simplewebauthn/browser";
import { Loader2, KeyRound, Plus, Trash2 } from "lucide-react";

export function PasskeySettings() {
  const [passkeysEnabled, setPasskeysEnabled] = useState(false);
  const [passkeys, setPasskeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const { enabled } = await api.getPasskeyStatus();
        setPasskeysEnabled(enabled);
        if (enabled) {
          const { passkeys: pkList } = await api.listPasskeys();
          setPasskeys(pkList);
        }
      } catch (err) {
        // Ignore or handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleRegisterPasskey = async () => {
    try {
      setRegistering(true);
      setError("");

      const options = await api.generatePasskeyRegistrationOptions();

      const response = await startRegistration({ optionsJSON: options });

      const name = prompt("Enter a name for this passkey (e.g. MacBook, YubiKey)", "Passkey");
      if (name === null) return; // User cancelled

      await api.verifyPasskeyRegistration({ name, response });

      const { passkeys: pkList } = await api.listPasskeys();
      setPasskeys(pkList);
    } catch (err: any) {
      setError(err.message || "Failed to register passkey.");
    } finally {
      setRegistering(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    if (!confirm("Are you sure you want to delete this passkey?")) return;
    try {
      await api.deletePasskey(id);
      setPasskeys(passkeys.filter((pk) => pk.id !== id));
    } catch (err: any) {
      setError(err.message || "Failed to delete passkey.");
    }
  };

  if (loading) return null;

  if (passkeysEnabled) {
    return (
      <div className="p-5 rounded-xl border border-border/50 bg-bg-card space-y-4">
        <div>
          <p className="text-sm font-medium">Passkeys</p>
          <p className="text-xs text-text-muted">
            Sign in securely using fingerprint, face recognition, or a hardware security key.
          </p>
        </div>

        {error && (
          <div className="p-2 rounded bg-error/5 border border-error/20 text-error text-xs">
            {error}
          </div>
        )}

        {passkeys.length > 0 ? (
          <div className="space-y-2">
            {passkeys.map((pk) => (
              <div
                key={pk.id}
                className="flex items-center justify-between p-3 rounded-lg bg-bg border border-border/50"
              >
                <div className="flex items-center gap-3">
                  <KeyRound className="w-5 h-5 text-text-muted" />
                  <div>
                    <p className="text-sm font-medium">{pk.name || "Passkey"}</p>
                    <p className="text-xs text-text-muted">
                      Added {new Date(pk.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeletePasskey(pk.id)}
                  className="p-1.5 rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                  title="Delete passkey"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted">No passkeys registered.</p>
        )}

        <button
          onClick={handleRegisterPasskey}
          disabled={registering}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          {registering ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
          Add a Passkey
        </button>
      </div>
    );
  } else {
    return (
      <div className="p-5 rounded-xl border border-border/50 bg-bg-card/50 opacity-60">
        <div className="flex items-center gap-3">
          <KeyRound className="w-5 h-5 text-text-muted" />
          <div>
            <p className="text-sm font-medium">Passkeys are disabled</p>
            <p className="text-xs text-text-muted">
              Enable passkeys by removing <code>OPTIO_ENABLE_PASSKEYS=false</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }
}
