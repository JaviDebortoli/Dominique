"use client";

// Admin login form (design.md D7, tasks.md 7.2). middleware.ts already
// blocks every OTHER /admin/* route for an unauthenticated visitor and
// redirects them here — this page itself stays reachable (see
// auth.config.ts's authorized() callback).
import { useActionState } from "react";
import { authenticate } from "./actions";

export default function AdminLoginPage() {
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-margin-mobile">
      <h1 className="font-serif text-headline-md text-ink">Ingresar</h1>
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="border border-ink/20 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 font-sans text-body-md text-ink">
          Contraseña
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="border border-ink/20 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="w-full bg-nude px-8 py-3 font-sans text-label-caps uppercase tracking-widest text-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Ingresando…" : "Ingresar"}
        </button>
        {errorMessage ? (
          <p role="alert" className="font-sans text-body-md text-red-700">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </main>
  );
}
