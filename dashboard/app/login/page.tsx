"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupDone, setSignupDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();

    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        setSignupDone(true);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        window.location.href = "/";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (signupDone) {
    return (
      <div className="relative flex min-h-screen items-center justify-center p-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_10%,rgba(236,72,153,0.24),transparent_40%),radial-gradient(circle_at_85%_5%,rgba(251,146,60,0.18),transparent_40%)]" />
        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950/80 p-7 shadow-[0_40px_90px_-35px_rgba(244,63,94,0.5)] backdrop-blur-2xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-rose-500 text-lg font-bold text-white">
            J
          </div>
          <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-100">
            Check your email
          </h1>
          <p className="mt-3 text-center text-sm text-slate-300">
            We sent a confirmation link to{" "}
            <strong className="text-slate-100">{email}</strong>. Confirm your account, then return
            here to log in.
          </p>
          <button
            className="mt-6 h-11 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 to-rose-500 text-sm font-semibold text-white shadow-lg shadow-rose-500/30 transition hover:brightness-110"
            onClick={() => {
              setSignupDone(false);
              setMode("login");
            }}
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_10%,rgba(236,72,153,0.24),transparent_40%),radial-gradient(circle_at_85%_5%,rgba(251,146,60,0.18),transparent_40%)]" />
      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950/80 p-7 shadow-[0_40px_90px_-35px_rgba(244,63,94,0.5)] backdrop-blur-2xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-rose-500 text-lg font-bold text-white">
          J
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-100">
          Jeff Intelligence
        </h1>
        <p className="mt-2 text-center text-sm text-slate-400">
          {mode === "login" ? "Sign in to your command dashboard" : "Create your account"}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-300/50 focus:outline-none focus:ring-2 focus:ring-rose-300/25"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-300/50 focus:outline-none focus:ring-2 focus:ring-rose-300/25"
          />

          {error && (
            <p className="rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </p>
          )}

          <button
            className="h-11 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 to-rose-500 text-sm font-semibold text-white shadow-lg shadow-rose-500/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            type="submit"
            disabled={loading}
          >
            {loading ? "..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-400">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button
                className="font-semibold text-rose-200 transition hover:text-rose-100"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                className="font-semibold text-rose-200 transition hover:text-rose-100"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
