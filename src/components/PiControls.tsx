"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, KeyRound, LogIn, LogOut, Terminal, UserRound } from "lucide-react";
import { PiState, SessionModel } from "@/types";
import { fetchJson, messageOf } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

const dialogClasses =
  "border border-white/10 bg-stone-950/95 text-stone-200 backdrop-blur-2xl sm:max-w-md";
const labelClasses =
  "text-[10px] font-bold uppercase tracking-widest text-stone-500";
const inputClasses =
  "w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-200 placeholder-stone-500 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 focus:outline-none";

/**
 * The /model counterpart. scope "default" writes pi's settings.json (what any
 * new session starts on); scope "session" appends a model_change entry to one
 * session file, which pi honors on its next run against that session.
 */
export function ModelDialog({
  open,
  onOpenChange,
  scope,
  file,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: "default" | "session";
  file?: string;
  current?: SessionModel | null;
  onSaved?: () => void;
}) {
  const [state, setState] = useState<PiState | null>(null);
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState("");
  const [saving, setSaving] = useState(false);

  // Fetch pi's state when the dialog opens and preselect the model the scope
  // is currently on — all inside the fetch callback, never in the effect body.
  const currentProvider = current?.provider;
  const currentModelId = current?.modelId;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchJson<PiState>("/api/pi/state")
      .then((fetched) => {
        if (cancelled) return;
        setState(fetched);
        const active =
          scope === "session"
            ? currentProvider && currentModelId
              ? { provider: currentProvider, modelId: currentModelId }
              : null
            : fetched.settings.defaultProvider && fetched.settings.defaultModel
              ? {
                  provider: fetched.settings.defaultProvider,
                  modelId: fetched.settings.defaultModel,
                }
              : null;
        setProvider(active?.provider ?? "");
        setModelId(active?.modelId ?? "");
        setThinkingLevel(
          scope === "default"
            ? (fetched.settings.defaultThinkingLevel ?? "")
            : "",
        );
      })
      .catch((err) => !cancelled && toast(messageOf(err)));
    return () => {
      cancelled = true;
    };
  }, [open, scope, currentProvider, currentModelId]);

  const grouped = useMemo(() => {
    const byProvider = new Map<string, PiState["models"]>();
    for (const model of state?.models ?? []) {
      byProvider.set(model.provider, [
        ...(byProvider.get(model.provider) ?? []),
        model,
      ]);
    }
    return [...byProvider.entries()];
  }, [state]);

  const save = async () => {
    if (saving || !provider.trim() || !modelId.trim()) return;
    setSaving(true);
    try {
      await fetchJson("/api/pi/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          file,
          provider: provider.trim(),
          modelId: modelId.trim(),
          thinkingLevel: thinkingLevel || undefined,
        }),
      });
      toast(
        scope === "session"
          ? `This session will continue on ${provider}/${modelId}.`
          : `New sessions will use ${provider}/${modelId}.`,
      );
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClasses}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-amber-400" aria-hidden="true" />
            {scope === "session" ? "Model for this session" : "Default model"}
          </DialogTitle>
          <DialogDescription>
            {scope === "session"
              ? "Applies from the next message sent to this session."
              : "What pi starts new sessions with — the UI counterpart of /model."}
          </DialogDescription>
        </DialogHeader>

        {grouped.length > 0 ? (
          <div className="custom-scrollbar max-h-56 space-y-3 overflow-y-auto pr-1">
            {grouped.map(([providerId, models]) => (
              <div key={providerId}>
                <p className={`${labelClasses} mb-1`}>{providerId}</p>
                <ul className="space-y-1">
                  {models.map((model) => {
                    const selected =
                      provider === providerId && modelId === model.id;
                    return (
                      <li key={`${providerId}/${model.id}`}>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setProvider(providerId);
                            setModelId(model.id);
                          }}
                          aria-pressed={selected}
                          className={`h-auto w-full justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
                            selected
                              ? "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/20 dark:hover:bg-amber-500/20"
                              : "border-transparent text-stone-300 hover:bg-white/5 dark:hover:bg-white/5"
                          }`}
                        >
                          <span className="truncate">
                            {model.name || model.id}
                          </span>
                          {model.reasoning && (
                            <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-400">
                              reasoning
                            </span>
                          )}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-500">
            No fetched models yet — pi fills its model store after a provider
            login. You can still set one by hand below.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelClasses}>Provider</span>
            <input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              list="pi-provider-suggestions"
              placeholder="anthropic"
              className={inputClasses}
            />
          </label>
          <label className="block">
            <span className={labelClasses}>Model id</span>
            <input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="claude-opus-4-6"
              className={inputClasses}
            />
          </label>
        </div>
        <datalist id="pi-provider-suggestions">
          {[...new Set([...(state?.knownProviders ?? []), ...(state?.oauthProviders ?? [])])].map(
            (p) => (
              <option key={p} value={p} />
            ),
          )}
        </datalist>

        <label className="block">
          <span className={labelClasses}>Thinking level</span>
          <select
            value={thinkingLevel}
            onChange={(e) => setThinkingLevel(e.target.value)}
            className={inputClasses}
          >
            <option value="">keep current</option>
            {(state?.thinkingLevels ?? []).map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            onClick={save}
            disabled={saving || !provider.trim() || !modelId.trim()}
            className="bg-amber-600 text-white hover:bg-amber-500"
          >
            {saving ? "Saving…" : "Use this model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The /login counterpart: account (pi's own OAuth, in a terminal) or API key. */
function LoginDialog({
  open,
  onOpenChange,
  state,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: PiState | null;
  onChanged: () => void;
}) {
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset the form each time the dialog opens, during render, not an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setProvider("");
      setApiKey("");
    }
  }

  const loginOauth = async () => {
    try {
      await fetchJson("/api/pi/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "oauth" }),
      });
      toast("Terminal opened — run /login there, then come back.");
      onOpenChange(false);
    } catch (err) {
      toast(messageOf(err));
    }
  };

  const loginApiKey = async () => {
    if (saving || !provider.trim() || !apiKey.trim()) return;
    setSaving(true);
    try {
      await fetchJson("/api/pi/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "api_key",
          provider: provider.trim(),
          apiKey: apiKey.trim(),
        }),
      });
      toast(`API key stored for ${provider.trim()}.`);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClasses}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-4 w-4 text-amber-400" aria-hidden="true" />
            Log in
          </DialogTitle>
          <DialogDescription>
            The UI counterpart of /login — credentials land in pi&apos;s own
            auth store, shared with the terminal.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="mb-1 flex items-center gap-2 text-sm font-bold text-stone-200">
            <UserRound className="h-4 w-4 text-amber-400" aria-hidden="true" />
            With an account
          </p>
          <p className="mb-2 text-xs text-stone-400">
            OAuth sign-in ({(state?.oauthProviders ?? []).join(", ")}) is
            interactive, so it runs in pi itself.
          </p>
          <Button
            variant="ghost"
            onClick={loginOauth}
            className="h-auto gap-2 rounded-xl bg-amber-500/20 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/30 dark:hover:bg-amber-500/30"
          >
            <Terminal className="h-4 w-4" aria-hidden="true" />
            Open a terminal with pi /login
          </Button>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-stone-200">
            <KeyRound className="h-4 w-4 text-amber-400" aria-hidden="true" />
            With an API key
          </p>
          <div className="space-y-2">
            <label className="block">
              <span className={labelClasses}>Provider</span>
              <input
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                list="pi-provider-suggestions-login"
                placeholder="anthropic"
                className={inputClasses}
              />
            </label>
            <datalist id="pi-provider-suggestions-login">
              {(state?.knownProviders ?? []).map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <label className="block">
              <span className={labelClasses}>API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                className={inputClasses}
              />
            </label>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            onClick={loginApiKey}
            disabled={saving || !provider.trim() || !apiKey.trim()}
            className="bg-amber-600 text-white hover:bg-amber-500"
          >
            {saving ? "Saving…" : "Save API key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The /logout counterpart: pick which stored credential to drop. */
function LogoutDialog({
  open,
  onOpenChange,
  state,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: PiState | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const logout = async (provider: string) => {
    setBusy(provider);
    try {
      await fetchJson("/api/pi/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      toast(`Logged out of ${provider}.`);
      onChanged();
    } catch (err) {
      toast(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  const accounts = state?.accounts ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClasses}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-4 w-4 text-amber-400" aria-hidden="true" />
            Log out
          </DialogTitle>
          <DialogDescription>
            Removes the stored credential from pi&apos;s auth store.
          </DialogDescription>
        </DialogHeader>

        {accounts.length === 0 ? (
          <p className="text-sm text-stone-500">No stored credentials.</p>
        ) : (
          <ul className="space-y-1">
            {accounts.map((account) => (
              <li
                key={account.provider}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm text-stone-200">
                  {account.provider}
                  <span className="ml-2 rounded-md bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-400">
                    {account.type === "oauth" ? "account" : "api key"}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  onClick={() => logout(account.provider)}
                  disabled={busy === account.provider}
                  className="h-auto shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/15 hover:text-red-200 dark:hover:bg-red-500/15"
                >
                  {busy === account.provider ? "…" : "Log out"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bottom-of-sidebar section: current default model + account management. */
export default function PiControls() {
  const [state, setState] = useState<PiState | null>(null);
  const [dialog, setDialog] = useState<"login" | "logout" | "model" | null>(null);

  const reload = useCallback(() => {
    fetchJson<PiState>("/api/pi/state")
      .then(setState)
      .catch((err) => console.error(err));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const { defaultProvider, defaultModel } = state?.settings ?? {};

  return (
    <div className="mt-2 shrink-0 border-t border-white/10 pt-3">
      <p className={`${labelClasses} mb-1 px-2`}>Model</p>
      <Button
        variant="ghost"
        onClick={() => setDialog("model")}
        title="Change the model pi uses for new sessions"
        className="h-auto w-full justify-start gap-2 rounded-xl px-2 py-2 text-left font-mono text-xs text-stone-300 hover:bg-stone-900 dark:hover:bg-stone-900 hover:text-amber-200"
      >
        <Cpu className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <span className="truncate">
          {defaultProvider && defaultModel
            ? `${defaultProvider}/${defaultModel}`
            : "Choose a model…"}
        </span>
      </Button>

      <p className={`${labelClasses} mt-2 mb-1 px-2`}>Accounts</p>
      {state && state.accounts.length > 0 && (
        <ul className="mb-1 space-y-0.5 px-2">
          {state.accounts.map((account) => (
            <li
              key={account.provider}
              className="truncate font-mono text-xs text-stone-400"
              title={`${account.provider} (${account.type === "oauth" ? "account" : "api key"})`}
            >
              {account.provider}
              <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-stone-600">
                {account.type === "oauth" ? "account" : "api key"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1 px-1">
        <Button
          variant="ghost"
          onClick={() => setDialog("login")}
          className="h-auto flex-1 justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold text-stone-300 hover:bg-stone-900 dark:hover:bg-stone-900 hover:text-white"
        >
          <LogIn className="h-3.5 w-3.5" aria-hidden="true" /> Log in
        </Button>
        <Button
          variant="ghost"
          onClick={() => setDialog("logout")}
          disabled={!state || state.accounts.length === 0}
          className="h-auto flex-1 justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold text-stone-300 hover:bg-stone-900 dark:hover:bg-stone-900 hover:text-white disabled:opacity-40"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Log out
        </Button>
      </div>

      <LoginDialog
        open={dialog === "login"}
        onOpenChange={(open) => setDialog(open ? "login" : null)}
        state={state}
        onChanged={reload}
      />
      <LogoutDialog
        open={dialog === "logout"}
        onOpenChange={(open) => setDialog(open ? "logout" : null)}
        state={state}
        onChanged={reload}
      />
      <ModelDialog
        open={dialog === "model"}
        onOpenChange={(open) => setDialog(open ? "model" : null)}
        scope="default"
        onSaved={reload}
      />
    </div>
  );
}
