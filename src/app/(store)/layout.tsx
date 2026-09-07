import { prisma } from "@/lib/db";
import { listCategoriesWithThumbnail } from "@/modules/catalog/category.service";
import { getCart } from "@/modules/cart/cart-cookie";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";

// Shared storefront chrome (pickup banner, nav, footer) for every page in
// this route group (design.md D1: app/(store)/** is routes/UI only,
// business rules live in src/modules/catalog). Backs
// specs/storefront-browsing/spec.md:
//   - "Home Page Layout" navigation requirement, reused across
//     home/categoría/producto per ejemplo/code.html's shared header/footer.
//   - "Header Cart Entry Point": cartCount is read here (cookie only, no
//     Prisma — design.md D2) and passed down as a plain prop so Header stays
//     a synchronous, prop-tested presentational component. This is also the
//     boundary design.md D3's refresh() re-renders after any cart-mutating
//     Server Action, so the badge is always server-derived, never
//     client-guessed, including before hydration.
export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const categories = await listCategoriesWithThumbnail(prisma);
  const cart = await getCart();
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Header categories={categories} cartCount={cartCount} />
      <main className="flex-grow">{children}</main>
      <Footer />
    </div>
  );
}
