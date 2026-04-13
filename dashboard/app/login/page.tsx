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
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_10%,rgba(217,70,239,0.09),transparent_42%),radial-gradient(circle_at_85%_5%,rgba(249,115,22,0.07),transparent_42%)]" />
        <div className="surface-card relative w-full max-w-md border border-fuchsia-200/40 p-7">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-orange-600 text-lg font-bold text-white shadow-lg shadow-violet-950/35">
            J
          </div>
          <h1 className="text-center text-2xl font-semibold tracking-tight text-zinc-900">
            Check your email
          </h1>
          <p className="mt-3 text-center text-sm text-zinc-600">
            We sent a confirmation link to{" "}
            <strong className="text-zinc-900">{email}</strong>. Confirm your account, then return
            here to log in.
          </p>
          <button
            className="btn-primary mt-6 h-11 w-full text-sm"
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_10%,rgba(217,70,239,0.09),transparent_42%),radial-gradient(circle_at_85%_5%,rgba(249,115,22,0.07),transparent_42%)]" />
      <div className="surface-card relative w-full max-w-md border border-fuchsia-200/40 p-7">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-orange-600 text-lg font-bold text-white shadow-lg shadow-violet-950/35">
          J
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight text-zinc-900">
          Jeff Intelligence
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
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
            className="input-hybrid h-11 w-full"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="input-hybrid h-11 w-full"
          />

          {error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          )}

          <button
            className="btn-primary h-11 w-full text-sm"
            type="submit"
            disabled={loading}
          >
            {loading ? "..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-zinc-500">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button
                className="font-semibold text-fuchsia-700 transition hover:text-fuchsia-900"
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
                className="font-semibold text-fuchsia-700 transition hover:text-fuchsia-900"
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
