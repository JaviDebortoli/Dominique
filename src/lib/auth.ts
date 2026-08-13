// Full Auth.js config — Node.js runtime only (route handlers, server
// actions). Extends src/lib/auth.config.ts's edge-safe base with the real
// Credentials provider, which delegates all verification to
// src/modules/auth/admin-auth.service.ts (design.md D1: business logic
// lives in the module, never inline in a framework callback).
//
// Backs specs/admin-console/spec.md "Authenticated Access" and design.md D7.
// tasks.md 7.1/7.2.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { prisma } from "./db";
import { verifyAdminCredentials } from "@/modules/auth/admin-auth.service";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const identity = await verifyAdminCredentials(
          prisma,
          credentials?.email,
          credentials?.password,
        );
        if (!identity) return null;
        return { id: identity.id, email: identity.email, name: identity.name ?? identity.email };
      },
    }),
  ],
});
