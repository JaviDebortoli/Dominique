import { prisma } from "@/lib/db";
import {
  listCategoriesWithThumbnail,
} from "@/modules/catalog/category.service";
import { listCuratedProducts } from "@/modules/catalog/product.service";
import { CategoryTile } from "@/components/storefront/CategoryTile";
import { ProductCard } from "@/components/storefront/ProductCard";

// Storefront home page. Backs specs/storefront-browsing/spec.md "Home Page
// Layout": "the system SHALL display navigation, curated product sections,
// and category entry points matching the mockup" (ejemplo/code.html).
// Reads Prisma/services directly (design.md D1 — RSC pages, no client
// fetch layer).
export default async function Home() {
  const [categories, curatedProducts] = await Promise.all([
    listCategoriesWithThumbnail(prisma),
    listCuratedProducts(prisma, { take: 4 }),
  ]);

  return (
    <>
      {/* Hero */}
      <section className="relative flex h-[70vh] w-full items-center justify-center overflow-hidden border-b border-ink bg-surface-dim">
        <div className="relative z-10 flex flex-col items-center px-margin-mobile text-center">
          <h1 className="mb-6 font-serif text-display-lg text-ink">
            Nueva Colección:
            <br />
            <span className="italic">Sentite Real</span>
          </h1>
          <a
            href="#novedades"
            className="border border-ink bg-transparent px-8 py-3 font-sans text-label-caps uppercase tracking-widest text-ink transition-colors duration-300 hover:bg-ink hover:text-paper"
          >
            Ver Novedades
          </a>
        </div>
      </section>

      {/* Category entry points */}
      {categories.length > 0 && (
        <section className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {categories.map((category) => (
              <CategoryTile key={category.id} category={category} />
            ))}
          </div>
        </section>
      )}

      {/* Filosofía */}
      <section className="border-y border-ink bg-surface-container py-section">
        <div className="mx-auto max-w-3xl px-margin-mobile text-center">
          <h2 className="mb-6 font-serif text-headline-lg-mobile text-ink md:text-headline-lg">
            Moda sin Excepciones
          </h2>
          <p className="mb-8 font-sans text-body-lg leading-relaxed text-on-surface-variant">
            Creemos que la elegancia no tiene talla. Dominique nació para
            ofrecer diseño, calidad y sofisticación en medidas reales.
          </p>
        </div>
      </section>

      {/* Curated products */}
      <section
        id="novedades"
        className="mx-auto max-w-container px-margin-mobile py-section md:px-gutter"
      >
        <div className="mb-12 flex items-end justify-between border-b border-ink pb-4">
          <h2 className="font-serif text-headline-md text-ink">
            Selección Dominique
          </h2>
        </div>
        {curatedProducts.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-4 md:gap-8">
            {curatedProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={{
                  slug: product.slug,
                  name: product.name,
                  price: Number(product.price),
                  thumbnailUrl: product.images[0]?.url ?? null,
                  thumbnailAlt: product.images[0]?.altText ?? null,
                }}
              />
            ))}
          </div>
        ) : (
          <p className="font-sans text-body-md text-on-surface-variant">
            Muy pronto vas a poder ver toda la colección acá.
          </p>
        )}
      </section>

      {/* Trust banner */}
      <section className="border-y border-ink bg-paper py-12">
        <div className="mx-auto max-w-container px-margin-mobile md:px-gutter">
          <div className="grid grid-cols-1 gap-8 divide-y divide-ink/20 text-center md:grid-cols-3 md:divide-x md:divide-y-0">
            <div className="flex flex-col items-center pt-8 md:pt-0">
              <h4 className="mb-2 font-serif text-[20px] text-ink">
                Retiro en Local
              </h4>
              <p className="font-sans text-sm text-on-surface-variant">
                Plata 192, Santiago del Estero
              </p>
            </div>
            <div className="flex flex-col items-center pt-8 md:pt-0">
              <h4 className="mb-2 font-serif text-[20px] text-ink">
                Variedad de Talles
              </h4>
              <p className="font-sans text-sm text-on-surface-variant">
                Moda diseñada para vos
              </p>
            </div>
            <div className="flex flex-col items-center pt-8 md:pt-0">
              <h4 className="mb-2 font-serif text-[20px] text-ink">
                Pagá online o al retirar
              </h4>
              <p className="font-sans text-sm text-on-surface-variant">
                MercadoPago, efectivo o transferencia
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
