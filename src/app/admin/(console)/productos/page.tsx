// /admin/productos — admin catalog listing (tasks.md 7.3), now with inline
// edit/delete per row (tasks.md 5.3, design.md F9). Categories are fetched
// server-side exactly like productos/nuevo/page.tsx does and handed to
// each ProductRow for its edit-mode category <select> — the row itself
// never fetches. `price` is converted to a plain number here (design.md's
// existing pattern at every RSC/client boundary, e.g.
// categoria/[slug]/page.tsx) since Prisma's Decimal does not cross into a
// "use client" component. specs/admin-console/spec.md "Product and Variant
// Management": staff manage products "without engineering assistance" —
// wired to the SAME catalog service the storefront and seed script use
// (design.md D1).
import Link from "next/link";
import { prisma } from "@/lib/db";
import { listAllProductsForAdmin } from "@/modules/catalog/product.service";
import { ProductRow } from "./ProductRow";

export default async function AdminProductsPage() {
  // Sequential, not Promise.all — matches productos/nuevo/page.tsx:12's
  // single-query precedent; the local pglite dev proxy this project runs
  // against does not handle concurrent queries from one PrismaClient
  // reliably (this session's own "Connection terminated unexpectedly"
  // flake under Promise.all here).
  const products = await listAllProductsForAdmin(prisma);
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  const categoryOptions = categories.map((category) => ({
    id: category.id,
    name: category.name,
  }));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-headline-md text-ink">Productos</h1>
        <Link
          href="/admin/productos/nuevo"
          className="bg-nude px-6 py-2 font-sans text-label-caps uppercase tracking-widest text-ink hover:opacity-90"
        >
          Nuevo producto
        </Link>
      </div>

      <table className="w-full border-collapse font-sans text-body-md text-ink">
        <thead>
          <tr className="border-b border-ink/20 text-left">
            <th className="py-2">Producto</th>
            <th className="py-2">Categoría</th>
            <th className="py-2 text-right">Precio</th>
            <th className="py-2 text-right">Variantes</th>
            <th className="py-2 text-right">Imágenes</th>
            <th className="py-2 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={{ ...product, price: Number(product.price) }}
              categories={categoryOptions}
            />
          ))}
          {products.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-6 text-center text-outline">
                Todavía no hay productos.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
