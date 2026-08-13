// /admin/productos — admin catalog listing (tasks.md 7.3).
// specs/admin-console/spec.md "Product and Variant Management": staff
// manage products "without engineering assistance" — this list is the
// starting point, wired to the SAME catalog service the storefront and
// seed script use (design.md D1).
import Link from "next/link";
import { formatPriceARS } from "@/lib/format-price";
import { prisma } from "@/lib/db";
import { listAllProductsForAdmin } from "@/modules/catalog/product.service";

export default async function AdminProductsPage() {
  const products = await listAllProductsForAdmin(prisma);

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
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-ink/10">
              <td className="py-2">{product.name}</td>
              <td className="py-2">{product.category.name}</td>
              <td className="py-2 text-right">{formatPriceARS(Number(product.price))}</td>
              <td className="py-2 text-right">{product.variants.length}</td>
              <td className="py-2 text-right">
                {product.images.length === 0 ? (
                  <span className="text-red-700">Sin imágenes</span>
                ) : (
                  product.images.length
                )}
              </td>
            </tr>
          ))}
          {products.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-outline">
                Todavía no hay productos.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
