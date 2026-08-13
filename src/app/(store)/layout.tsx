import { prisma } from "@/lib/db";
import { listCategoriesWithThumbnail } from "@/modules/catalog/category.service";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";

// Shared storefront chrome (pickup banner, nav, footer) for every page in
// this route group (design.md D1: app/(store)/** is routes/UI only,
// business rules live in src/modules/catalog). Backs
// specs/storefront-browsing/spec.md "Home Page Layout" navigation
// requirement, reused across home/categoría/producto per
// ejemplo/code.html's shared header/footer.
export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const categories = await listCategoriesWithThumbnail(prisma);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Header categories={categories} />
      <main className="flex-grow">{children}</main>
      <Footer />
    </div>
  );
}
