import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";

// End-to-end verification of specs/admin-console/spec.md "Owner adds a
// variant to an existing product" against the real running app + real
// Postgres (tasks.md 3.1, PR 1 of 2 — variant-add slice). Mirrors
// e2e/admin-productos-edicion.spec.ts's loginAsAdmin() helper and
// DEV_ADMIN_* credentials (prisma/seed.ts's seedAdminUser()).
//
// The image add/delete scenarios (design.md G1-G4/G7/G8, tasks.md 8.1/8.2,
// PR 2 of 2 — image add/delete slice) are added below by their own
// test.describe block, each with its own dedicated product so parallel
// execution (playwright.config.ts's fullyParallel: true) never collides.

const DEV_ADMIN_EMAIL = "admin@dominique.local";
const DEV_ADMIN_PASSWORD = "Dominique-Dev-Only-2026!";

// A genuinely valid 1x1 transparent PNG (real magic bytes + real pixel
// data) so the upload route's file-type sniff + sharp re-encode (design.md
// Threat Matrix, reused verbatim — not modified by this change) both
// succeed against real bytes, not a fake/renamed file.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(DEV_ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(DEV_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Ingresar/ }).click();
  await expect(page).toHaveURL(/\/admin\/caja/);
}

test.describe("Admin productos — avanzado: add variant (tasks.md 3.1)", () => {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const categoryName = `Categoria E2E Avanzado ${suffix}`;
  const productName = `Producto E2E Avanzado ${suffix}`;
  const productSlug = `producto-e2e-avanzado-${suffix}`;
  const newVariantSku = `AVZ-VAR-${suffix}`;

  let categoryId: string;
  let productId: string;

  test.beforeAll(async () => {
    const category = await prisma.category.create({
      data: { name: categoryName, slug: `categoria-e2e-avanzado-${suffix}` },
    });
    categoryId = category.id;

    const product = await createProduct(prisma, {
      name: productName,
      slug: productSlug,
      price: 15000,
      categoryId,
      variants: [{ size: "M", color: "Negro", sku: `AVZ-BASE-${suffix}`, onHand: 2 }],
    });
    productId = product.id;
  });

  test.afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  });

  test("owner adds a variant to an existing product", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/productos");

    const row = page.getByRole("row", { name: new RegExp(productName) });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "1" }).click();

    await page.getByLabel(/talle/i).fill("L");
    await page.getByLabel(/color/i).fill("Negro");
    await page.getByLabel(/^sku$/i).fill(newVariantSku);
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes(`/api/admin/products/${productId}/variants`) && res.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Agregar" }).click(),
    ]);
    expect(response.status()).toBe(201);

    await expect(page.getByText(newVariantSku)).toBeVisible();
    // No stock column is exposed on the newly created variant's sub-row —
    // its onHand: 0 is not surfaced as an editable/visible number here.
    await expect(page.getByLabel(/stock/i)).toHaveCount(0);
  });
});

test.describe("Admin productos — avanzado: images (tasks.md 8.1/8.2, PR 2 of 2)", () => {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const categoryName = `Categoria E2E Imagenes ${suffix}`;

  const uploadProductName = `Producto E2E Subir Imagen ${suffix}`;
  const uploadProductSlug = `producto-e2e-subir-imagen-${suffix}`;

  const deleteProductName = `Producto E2E Eliminar Imagen ${suffix}`;
  const deleteProductSlug = `producto-e2e-eliminar-imagen-${suffix}`;

  let categoryId: string;
  let uploadProductId: string;
  let deleteProductId: string;

  test.beforeAll(async () => {
    const category = await prisma.category.create({
      data: { name: categoryName, slug: `categoria-e2e-imagenes-${suffix}` },
    });
    categoryId = category.id;

    // Starts with ZERO images so 8.1 can assert one appears both in the
    // admin gallery and (as the new images[0]) on the storefront PDP.
    const uploadProduct = await createProduct(prisma, {
      name: uploadProductName,
      slug: uploadProductSlug,
      price: 22000,
      categoryId,
      variants: [{ size: "U", color: "Negro", sku: `IMGUP-${suffix}`, onHand: 1 }],
    });
    uploadProductId = uploadProduct.id;

    // Starts with EXACTLY ONE image so 8.2 exercises deleting a product's
    // LAST remaining image (design.md G4 — freely allowed).
    const deleteProduct = await createProduct(prisma, {
      name: deleteProductName,
      slug: deleteProductSlug,
      price: 24000,
      categoryId,
      variants: [{ size: "U", color: "Negro", sku: `IMGDEL-${suffix}`, onHand: 1 }],
      images: [{ url: "/uploads/e2e-seed-placeholder.jpg", position: 0 }],
    });
    deleteProductId = deleteProduct.id;
  });

  test.afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: [uploadProductId, deleteProductId] } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  });

  test("owner uploads an image and it appears in the storefront gallery", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/productos");

    const row = page.getByRole("row", { name: new RegExp(uploadProductName) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "1" }).click();

    // The product has exactly 1 variant, so the expanded disclosure inserts
    // 3 sibling <tr>s right after the product's own row, in order: the
    // single VariantRow, AddVariantForm, then ProductImages (design.md G9).
    // Scoping to that 3rd sibling keeps this test independent of any other
    // product row also rendered on the page.
    const imagesRow = row.locator("xpath=following-sibling::tr[3]");
    const fileInput = imagesRow.getByLabel(/Subir imagen/i);
    const [uploadResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/admin/upload") && res.request().method() === "POST",
      ),
      fileInput.setInputFiles({
        name: "producto.png",
        mimeType: "image/png",
        buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      }),
    ]);
    expect(uploadResponse.status()).toBe(201);

    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/admin/products/${uploadProductId}/images`) &&
        res.request().method() === "POST" &&
        res.status() === 201,
    );

    // The thumbnail appears in the expanded admin gallery.
    await expect(imagesRow.locator("img").first()).toBeVisible();

    await page.goto(`/producto/${uploadProductSlug}`);
    // The uploaded image is now images[0] — the storefront PDP's primary
    // image, rendered where nothing was rendered before (the product
    // started with zero images).
    const storefrontImage = page.locator("img").first();
    await expect(storefrontImage).toBeVisible();
    await expect(storefrontImage).toHaveAttribute("src", /\/uploads\/products\/.+\.png$/);
  });

  test("owner deletes an image, including the last one", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/productos");

    const row = page.getByRole("row", { name: new RegExp(deleteProductName) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "1" }).click();

    // Same 3-sibling-<tr> layout as the upload test above (1 variant ->
    // VariantRow, AddVariantForm, ProductImages) — scope to ProductImages'
    // row so this only ever clicks the per-image Eliminar, never the
    // product-level Eliminar in the row itself or any other product row.
    const imagesRow = row.locator("xpath=following-sibling::tr[3]");

    page.once("dialog", (dialog) => void dialog.accept());
    const [deleteResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/admin/products/${deleteProductId}/images/`) &&
          res.request().method() === "DELETE",
      ),
      imagesRow.getByRole("button", { name: "Eliminar" }).click(),
    ]);
    expect(deleteResponse.status()).toBe(200);

    // The admin row still renders with zero images (design.md G4 — a
    // product with zero images is a valid, freely-reachable state).
    await expect(
      page.getByRole("row", { name: new RegExp(deleteProductName) }).getByText("Sin imágenes"),
    ).toBeVisible();
  });
});
