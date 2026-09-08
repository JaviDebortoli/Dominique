// /admin/categorias — admin category list + inline create form. Mirrors
// productos/page.tsx's shape (design.md D1, C5: single page, no separate
// /nuevo route — router.refresh() re-renders this same server component).
// Backs specs/admin-console/spec.md "Product and Variant Management":
// "Owner creates a category unaided". tasks.md 4.3.
//
// Acciones column added by the admin-categorias-edicion change (design.md
// E6): each row is a client CategoryRow with inline rename/delete, keeping
// this page an RSC. tasks.md 3.3.
import { prisma } from "@/lib/db";
import { listAllCategoriesForAdmin } from "@/modules/catalog/category.service";
import { CategoryRow } from "./CategoryRow";
import { NewCategoryForm } from "./NewCategoryForm";

export default async function AdminCategoriasPage() {
  const categories = await listAllCategoriesForAdmin(prisma);

  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="font-serif text-headline-md text-ink">Categorías</h1>

        <div className="overflow-x-auto border border-ink/15">
          <table className="w-full border-collapse font-sans text-body-md text-ink">
            <thead>
              <tr className="divide-x divide-ink/10 border-b border-ink/20 bg-surface text-left align-middle font-sans text-label-caps uppercase tracking-widest text-outline">
                <th className="px-4 py-3 font-semibold">Categoría</th>
                <th className="px-4 py-3 font-semibold">Slug</th>
                <th className="px-4 py-3 text-center font-semibold">Productos</th>
                <th className="px-4 py-3 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <CategoryRow key={category.id} category={category} />
              ))}
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-outline">
                    Todavía no hay categorías. Creá la primera acá abajo.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
