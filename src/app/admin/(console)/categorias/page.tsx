// /admin/categorias — admin category list + inline create form. Mirrors
// productos/page.tsx's shape (design.md D1, C5: single page, no separate
// /nuevo route — router.refresh() re-renders this same server component).
// Backs specs/admin-console/spec.md "Product and Variant Management":
// "Owner creates a category unaided". tasks.md 4.3.
import { prisma } from "@/lib/db";
import { listAllCategoriesForAdmin } from "@/modules/catalog/category.service";
import { NewCategoryForm } from "./NewCategoryForm";

export default async function AdminCategoriasPage() {
  const categories = await listAllCategoriesForAdmin(prisma);

  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="font-serif text-headline-md text-ink">Categorías</h1>

        <table className="w-full border-collapse font-sans text-body-md text-ink">
          <thead>
            <tr className="border-b border-ink/20 text-left">
              <th className="py-2">Categoría</th>
              <th className="py-2">Slug</th>
              <th className="py-2 text-right">Productos</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id} className="border-b border-ink/10">
                <td className="py-2">{category.name}</td>
                <td className="py-2">{category.slug}</td>
                <td className="py-2 text-right">{category.productCount}</td>
              </tr>
            ))}
            {categories.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-6 text-center text-outline">
                  Todavía no hay categorías. Creá la primera acá abajo.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="font-sans text-label-caps uppercase tracking-widest text-ink">
          Nueva categoría
        </h2>
        <NewCategoryForm />
      </div>
    </section>
  );
}
