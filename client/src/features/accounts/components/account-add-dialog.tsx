import { useEffect, useState } from "react";
import type { CreateAccountPayload } from "@/features/dashboard/api";

export type AccountAddDialogProps = {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: CreateAccountPayload) => Promise<void>;
};

type FormState = {
  email: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  chatgptAccountId: string;
  planType: string;
};

const initialState: FormState = {
  email: "",
  accessToken: "",
  refreshToken: "",
  idToken: "",
  chatgptAccountId: "",
  planType: "",
};

// 1. Dialog field ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function DialogField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          placeholder={placeholder}
          className="min-h-24 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          placeholder={placeholder}
          className="h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition-colors focus:border-primary/50"
        />
      )}
    </label>
  );
}

// 2. Account add dialog ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AccountAddDialog({ open, busy, error, onClose, onSubmit }: AccountAddDialogProps) {
  const [form, setForm] = useState<FormState>(initialState);

  useEffect(() => {
    if (!open) {
      setForm(initialState);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Add account</h2>
            <p className="mt-1 text-sm text-muted-foreground">Direct token import mapped to local `/api/accounts`.</p>
          </div>
          <button type="button" className="text-sm text-muted-foreground" onClick={onClose}>Close</button>
        </div>

        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit({
              email: form.email.trim() || null,
              accessToken: form.accessToken.trim(),
              refreshToken: form.refreshToken.trim(),
              idToken: form.idToken.trim(),
              chatgptAccountId: form.chatgptAccountId.trim() || null,
              planType: form.planType.trim() || null,
            });
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <DialogField label="Email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} placeholder="account@example.com" />
            <DialogField label="Plan type" value={form.planType} onChange={(value) => setForm((current) => ({ ...current, planType: value }))} placeholder="plus / pro / team" />
            <DialogField label="ChatGPT account ID" value={form.chatgptAccountId} onChange={(value) => setForm((current) => ({ ...current, chatgptAccountId: value }))} placeholder="optional" />
          </div>

          <DialogField label="Access token" value={form.accessToken} onChange={(value) => setForm((current) => ({ ...current, accessToken: value }))} multiline placeholder="Required" />
          <DialogField label="Refresh token" value={form.refreshToken} onChange={(value) => setForm((current) => ({ ...current, refreshToken: value }))} multiline placeholder="Required" />
          <DialogField label="ID token" value={form.idToken} onChange={(value) => setForm((current) => ({ ...current, idToken: value }))} multiline placeholder="Required" />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button type="button" className="h-10 rounded-full border border-border/60 px-4 text-sm font-medium" onClick={onClose}>Cancel</button>
            <button type="submit" className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground" disabled={busy}>
              {busy ? "Saving..." : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
