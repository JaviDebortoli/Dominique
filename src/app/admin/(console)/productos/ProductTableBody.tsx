"use client";

import { useState } from "react";
import type { AdminProductRow } from "@/modules/catalog/product.service";
import { ProductRow } from "./ProductRow";

interface ProductTableBodyProps {
  products: AdminProductRow[];
  categories: { id: string; name: string }[];
}

// Exclusive edit mode across rows: at most one product's edit form is open
// at a time. Opening "Editar" on a row closes whichever row was already
// open — the state has to live here, one level above ProductRow, because
// AdminProductsPage (the Server Component that lists these rows) can't hold
// client state itself.
export function ProductTableBody({ products, categories }: ProductTableBodyProps) {
  const [editingProductId, setEditingProductId] = useState<string | null>(null);

  return (
    <tbody>
      {products.map((product) => (
        <ProductRow
          key={product.id}
          product={{ ...product, price: Number(product.price) }}
          categories={categories}
          isEditing={editingProductId === product.id}
          onEnterEdit={() => setEditingProductId(product.id)}
          onExitEdit={() =>
            setEditingProductId((current) => (current === product.id ? null : current))
          }
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
  );
}
