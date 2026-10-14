"use client";

// Admin login form (design.md D7, tasks.md 7.2). middleware.ts already
// blocks every OTHER /admin/* route for an unauthenticated visitor and
// redirects them here — this page itself stays reachable (see
// auth.config.ts's authorized() callback).
import { useActionState, useState } from "react";
import { authenticate } from "./actions";

export default function AdminLoginPage() {
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

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
        <div className="flex flex-col gap-1 font-sans text-body-md text-ink">
          <label htmlFor="admin-login-password">Contraseña</label>
          <div className="relative">
            <input
              id="admin-login-password"
              name="password"
              type={isPasswordVisible ? "text" : "password"}
              required
              autoComplete="current-password"
              className="w-full border border-ink/20 py-2 pl-3 pr-11"
            />
            <button
              type="button"
              onClick={() => setIsPasswordVisible((visible) => !visible)}
              aria-label={isPasswordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={isPasswordVisible}
              aria-controls="admin-login-password"
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink/60 hover:text-ink"
            >
              {isPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>
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

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.8 3.7" />
      <path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
