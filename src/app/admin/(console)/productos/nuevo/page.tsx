import { NewProductForm } from "./NewProductForm";
import { prisma } from "@/lib/db";

// /admin/productos/nuevo — tasks.md 7.3: "owner creates product with
// variants/stock/images unaided". Category list is fetched server-side
// (RSC) and handed to the client form as plain data; the form itself POSTs
// to /api/admin/products (variants/stock) and /api/admin/upload (images,
// tasks.md 7.4/7.5) — both already-tested thin adapters over
// src/modules/catalog/product.service.ts and the magic-byte upload
// pipeline (design.md D1).
export default async function NewProductPage() {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });

  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-serif text-headline-md text-ink">Nuevo producto</h1>
      <NewProductForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </section>
  );
}
