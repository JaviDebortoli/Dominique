"use client";

// Product detail page image gallery. One large image plus a thumbnail
// strip; clicking a thumbnail swaps the large image. Ordering comes from
// the admin (ProductImages reorder -> ProductImage.position), so image 0
// is the cover. Backs specs/storefront-browsing/spec.md "Product Detail
// Page Image Gallery".
//
// Plain <img> (not next/image): admin-uploaded local files served from
// /uploads, not a configured remote image domain — mirrors ProductCard.tsx.
import { useState } from "react";

export interface GalleryImage {
  url: string;
  altText: string | null;
}

export function ProductGallery({
  images,
  productName,
}: {
  images: GalleryImage[];
  productName: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0) {
    return (
      <div
        className="aspect-[1/1.5] border border-ink/10 bg-surface-container"
        aria-hidden="true"
      />
    );
  }

  const safeIndex = Math.min(activeIndex, images.length - 1);
  const active = images[safeIndex];

  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-[1/1.5] overflow-hidden border border-ink/10 bg-surface-container">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.url}
          alt={active.altText ?? productName}
          className="h-full w-full object-cover"
        />
      </div>

      {images.length > 1 ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <li key={image.url}>
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Ver imagen ${index + 1} de ${images.length}`}
                aria-current={index === safeIndex ? "true" : undefined}
                className={`block h-16 w-16 overflow-hidden border ${
                  index === safeIndex ? "border-ink" : "border-ink/10 hover:border-ink/40"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
