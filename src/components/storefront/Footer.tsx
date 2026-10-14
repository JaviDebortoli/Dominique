// Backs specs/storefront-browsing/spec.md "Home Page Layout". Markup
// follows ejemplo/code.html's footer (brand blurb + store info, links).
// The presentation-only newsletter form was removed at the owner's request.
import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-section border-t border-ink bg-surface">
      <div className="mx-auto grid max-w-container grid-cols-1 gap-gutter px-margin-mobile py-section md:grid-cols-3 md:px-gutter">
        <div className="col-span-1 flex flex-col items-start">
          <p className="mb-4 font-serif text-headline-md uppercase tracking-widest text-ink">
            Dominique
          </p>
          <p className="max-w-xs font-sans text-body-md text-on-surface-variant">
            Talles reales, retiro exclusivo en local.
            <br />
            Plata 192, Santiago del Estero.
            <br />
            Horarios: Lun-Vie 9-19hs.
          </p>
        </div>
        <div className="col-span-1 flex flex-col gap-4">
          <a
            href="#"
            className="font-sans text-label-caps text-on-surface-variant transition-colors hover:text-ink"
          >
            Contacto
          </a>
          <Link
            href="/preguntas-frecuentes"
            className="font-sans text-label-caps text-on-surface-variant transition-colors hover:text-ink"
          >
            Preguntas Frecuentes
          </Link>
        </div>
        <div className="col-span-1 flex flex-col gap-4">
          <a
            href="#"
            className="font-sans text-label-caps text-on-surface-variant transition-colors hover:text-ink"
          >
            Instagram
          </a>
        </div>
      </div>
    </footer>
  );
}
