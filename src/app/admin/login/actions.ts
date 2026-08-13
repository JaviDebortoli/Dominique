"use server";

// Login server action — the ONLY place `signIn()` is called from
// (design.md D7: Auth.js Credentials + bcrypt). Delegates all credential
// verification to next-auth's Credentials provider (src/lib/auth.ts), which
// in turn delegates to src/modules/auth/admin-auth.service.ts's
// verifyAdminCredentials() — this file itself contains zero auth logic.
//
// Pattern follows the official Auth.js/Next.js App Router docs: `signIn()`
// throws a special `NEXT_REDIRECT` error on success (framework-level
// navigation), which is NOT an AuthError and must be allowed to propagate
// unchanged — only AuthError instances (real "invalid credentials"/config
// failures) are caught and turned into a form error message.
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/admin/caja",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return "Email o contraseña incorrectos.";
        default:
          return "No pudimos iniciar sesión. Intentá de nuevo.";
      }
    }
    // Re-throw next-auth's internal redirect (and any genuinely unexpected
    // error) — swallowing it here would break the post-login navigation.
    throw error;
  }
}
