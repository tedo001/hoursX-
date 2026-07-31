"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { api, ApiError, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password, name || email.split("@")[0]);
      setToken(token.access_token);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pulse-500 text-lg font-black text-ink-950">
            hX
          </span>
          <div>
            <h1 className="text-xl font-bold">HoursX Console</h1>
            <p className="text-sm text-slate-400">
              {mode === "login" ? "Sign in to continue" : "Create your account"}
            </p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="label">Display name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada"
              />
            </div>
          )}
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn w-full" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          className="mt-4 w-full text-center text-sm text-slate-400 hover:text-pulse-400"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login"
            ? "New here? Create an account"
            : "Already registered? Sign in"}
        </button>
      </div>
    </div>
  );
}
