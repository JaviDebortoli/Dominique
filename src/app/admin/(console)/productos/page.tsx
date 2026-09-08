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
import {
  listAllProductsForAdmin,
  type SerializableAdminProductRow,
} from "@/modules/catalog/product.service";
import { ProductTableBody } from "./ProductTableBody";

interface AdminProductsPageProps {
  searchParams: Promise<{ categoria?: string }>;
}

export default async function AdminProductsPage({ searchParams }: AdminProductsPageProps) {
  const { categoria } = await searchParams;

  // Sequential, not Promise.all — matches productos/nuevo/page.tsx:12's
  // single-query precedent; the local pglite dev proxy this project runs
  // against does not handle concurrent queries from one PrismaClient
  // reliably (this session's own "Connection terminated unexpectedly"
  // flake under Promise.all here).
  // Flatten every Prisma `Decimal` to a number HERE, on the server, before
  // the list crosses into the client `ProductTableBody` — React cannot
  // serialize `Decimal` class instances across that boundary ("Only plain
  // objects can be passed to Client Components").
  const productRows = await listAllProductsForAdmin(prisma, { categoryId: categoria });
  const products: SerializableAdminProductRow[] = productRows.map((product) => ({
    ...product,
    price: Number(product.price),
    variants: product.variants.map((variant) => ({
      ...variant,
      priceOverride: variant.priceOverride === null ? null : Number(variant.priceOverride),
    })),
  }));
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  const categoryOptions = categories.map((category) => ({
    id: category.id,
    name: category.name,
  }));
  // Only render the "filtered by" banner when the id actually resolves to a
  // real category — an unknown/stale ?categoria value silently falls back
  // to the full list instead of showing a broken filter label.
  const filteredCategory = categoria
    ? categoryOptions.find((category) => category.id === categoria)
    : undefined;

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

      {filteredCategory ? (
        <p className="font-sans text-body-md text-ink">
          Mostrando solo productos de <strong>{filteredCategory.name}</strong>.{" "}
          <Link href="/admin/productos" className="underline underline-offset-2">
            Ver todos
          </Link>
        </p>
      ) : null}

      <div className="overflow-x-auto border border-ink/15">
        <table className="w-full border-collapse font-sans text-body-md text-ink">
          <thead>
            <tr className="divide-x divide-ink/10 border-b border-ink/20 bg-surface text-left align-middle font-sans text-label-caps uppercase tracking-widest text-outline">
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 font-semibold">Categoría</th>
              <th className="px-4 py-3 text-right font-semibold">Precio</th>
              <th className="px-4 py-3 text-center font-semibold">Variantes</th>
              <th className="px-4 py-3 text-center font-semibold">Imágenes</th>
              <th className="px-4 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <ProductTableBody products={products} categories={categoryOptions} />
        </table>
      </div>
    </section>
  );
}
