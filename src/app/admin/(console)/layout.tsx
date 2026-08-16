// Authenticated admin console shell — nav + sign-out, wraps caja/productos/
// categorias/pedidos (NOT /admin/login, which lives outside this route
// group). src/proxy.ts already blocks unauthenticated access before this
// layout ever renders (design.md D7) — the auth() call below is a
// defense-in-depth read for displaying the logged-in staff member's email,
// not a second gate.
import Link from "next/link";
import { auth } from "@/lib/auth";
import { signOutAction } from "./actions";

export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/20 px-margin-mobile py-4 md:px-gutter">
        <nav className="flex gap-6 font-sans text-body-md text-ink">
          <Link href="/admin/caja">Caja</Link>
          <Link href="/admin/productos">Productos</Link>
          <Link href="/admin/categorias">Categorías</Link>
          <Link href="/admin/pedidos">Pedidos</Link>
        </nav>
        <div className="flex items-center gap-4 font-sans text-body-md text-ink">
          {session?.user?.email ? <span className="text-outline">{session.user.email}</span> : null}
          <form action={signOutAction}>
            <button type="submit" className="underline underline-offset-2">
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="px-margin-mobile py-8 md:px-gutter">{children}</main>
    </div>
  );
}
