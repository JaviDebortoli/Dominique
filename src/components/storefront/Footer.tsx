// Backs specs/storefront-browsing/spec.md "Home Page Layout". Markup
// follows ejemplo/code.html's footer (brand blurb + store info, links,
// newsletter form). The newsletter form is presentation-only in Phase 3 —
// wiring it to NewsletterSignup persistence is carried forward (see
// design.md Open Questions and tasks.md "Open Items Carried Forward").

export function Footer() {
  return (
    <footer className="mt-section border-t border-ink bg-surface">
      <div className="mx-auto grid max-w-container grid-cols-1 gap-gutter px-margin-mobile py-section md:grid-cols-4 md:px-gutter">
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
          <a
            href="#"
            className="font-sans text-label-caps text-on-surface-variant transition-colors hover:text-ink"
          >
            Preguntas Frecuentes
          </a>
        </div>
        <div className="col-span-1 flex flex-col gap-4">
          <a
            href="#"
            className="font-sans text-label-caps text-on-surface-variant transition-colors hover:text-ink"
          >
            Instagram
          </a>
        </div>
        <div className="col-span-1">
          <p className="mb-4 font-sans text-label-caps text-ink">Suscribite</p>
          <form className="flex border-b border-ink focus-within:border-b-2">
            <input
              className="w-full border-none bg-transparent px-0 py-2 font-sans text-label-caps text-ink placeholder-on-surface-variant focus:outline-none focus:ring-0"
              placeholder="TU EMAIL"
              type="email"
            />
            <button className="px-2" type="submit" aria-label="Suscribirse">
              →
            </button>
          </form>
        </div>
      </div>
    </footer>
  );
}
