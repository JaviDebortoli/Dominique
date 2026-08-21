import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/modules/catalog/product.service";
import { hold } from "@/modules/inventory/stock.service";
import type { MercadoPagoClient } from "@/modules/payments/mercadopago";

// task 5.1: preference created for a PENDING_PAYMENT order, 303 redirect to
// init_point. The real MP SDK boundary is swapped for a fake via vi.mock —
// no live credentials/network needed (see .env.example + apply-progress for
// what the owner still needs to do to go live).
let fakeCreatePreference: MercadoPagoClient["createPreference"] = async () => ({
  preferenceId: "pref-default",
  initPoint: "https://mercadopago.example.com/checkout/pref-default",
});
let createPreferenceCalls = 0;

vi.mock("@/modules/payments/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/payments/mercadopago")>();
  return {
    ...actual,
    createMercadoPagoClient: (): MercadoPagoClient => ({
      createPreference: (input) => {
        createPreferenceCalls += 1;
        return fakeCreatePreference(input);
      },
      getPayment: () => {
        throw new Error("not used in checkout route tests");
      },
    }),
  };
});

const { POST } = await import("./route");

// Integration tests against the real local Postgres, calling the exported
// Route Handler function directly (same pattern as the Phase 3 page tests —
// no need for a running HTTP server to exercise the real code path).
// Backs specs/cart-checkout/spec.md:
//   - "Stock Re-Validation at Submission" (tasks.md 4.5)
// and design.md D5 / Sequence — Stock & Reservation (tasks.md 4.6).
describe("POST /api/checkout (integration, real Postgres)", () => {
  const createdProductIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.stockMovement.deleteMany({
      where: { variant: { productId: { in: createdProductIds } } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  async function makeVariant(onHand: number) {
    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Checkout Route ${suffix}`, slug: `checkout-route-${suffix}` },
    });
    createdCategoryIds.push(category.id);

    const product = await createProduct(prisma, {
      name: `Producto Ruta ${suffix}`,
      slug: `producto-ruta-${suffix}`,
      price: 18000,
      categoryId: category.id,
      variants: [{ size: "U", color: "Unico", sku: `RTA-${suffix}`, onHand }],
    });
    createdProductIds.push(product.id);

    return product.variants[0];
  }

  function postRequest(body: unknown) {
    return new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates a RESERVED order and returns 201 with the public code (tasks.md 4.6, updated by 6.2/6.3)", async () => {
    const variant = await makeVariant(4);

    // PICKUP_CASH here, not MP: task 4.6's order-creation invariant is
    // method-agnostic, and Phase 5 (tasks.md 5.1) intentionally changed the
    // MP path's response shape to a 303 redirect (see "MercadoPago
    // preference creation" describe block below) — this test keeps proving
    // the 201-JSON contract for the non-MP path instead of colliding with
    // that new, correct behavior. Since Phase 6 (tasks.md 6.2), PICKUP_CASH
    // creates Order(RESERVED) rather than PENDING_PAYMENT — see
    // order.service.test.ts's "createPendingOrder — PICKUP_CASH creates a
    // RESERVED reservation" suite for the dedicated coverage of that rule.
    const response = await POST(
      postRequest({
        buyerName: "Cliente Prueba",
        phone: "3815550000",
        email: "cliente@example.com",
        method: "PICKUP_CASH",
        items: [{ variantId: variant.id, qty: 1 }],
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.publicCode).toMatch(/^DOM-/);
    createdOrderIds.push(body.orderId);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.status).toBe("RESERVED");
  });

  it("rejects with 409 when the line is no longer available (Stock Re-Validation at Submission)", async () => {
    const variant = await makeVariant(1);
    // Another order consumes the only unit before this checkout submits.
    await hold(prisma, { variantId: variant.id, qty: 1 });

    const response = await POST(
      postRequest({
        buyerName: "Cliente Tarde",
        phone: "3815550001",
        email: "tarde@example.com",
        method: "MP",
        items: [{ variantId: variant.id, qty: 1 }],
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("stock_unavailable");
    expect(body.variantIds).toContain(variant.id);

    const ordersForVariant = await prisma.orderItem.findMany({ where: { variantId: variant.id } });
    expect(ordersForVariant).toHaveLength(0);
  });

  it("rejects a request with missing contact fields with 400", async () => {
    const variant = await makeVariant(2);

    const response = await POST(
      postRequest({
        buyerName: "",
        phone: "3815550002",
        email: "sinnombre@example.com",
        method: "MP",
        items: [{ variantId: variant.id, qty: 1 }],
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  // tasks.md 1.1 — contact-format plausibility (design.md "Discriminated
  // validation result" decision). Empty phone/email are already rejected by
  // the existing shape check above (isNonEmptyString) and stay
  // `invalid_request` — these cases cover non-empty-but-implausible values,
  // which is what the new `isPlausibleEmail`/`isPlausiblePhone` checks add.
  describe("Contact format validation (tasks.md 1.1, specs/cart-checkout 'Checkout Contact Format Validation')", () => {
    it("rejects an obviously invalid email with 400 invalid_contact, field email, and creates no order/hold", async () => {
      const variant = await makeVariant(2);

      const response = await POST(
        postRequest({
          buyerName: "Cliente Email Malo",
          phone: "3815550020",
          email: "x",
          method: "MP",
          items: [{ variantId: variant.id, qty: 1 }],
        }),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_contact");
      expect(body.field).toBe("email");
      expect(typeof body.message).toBe("string");

      const ordersForVariant = await prisma.orderItem.findMany({ where: { variantId: variant.id } });
      expect(ordersForVariant).toHaveLength(0);
      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.held).toBe(0);
    });

    it("rejects an obviously invalid phone with 400 invalid_contact, field phone, and creates no order/hold", async () => {
      const variant = await makeVariant(2);

      const response = await POST(
        postRequest({
          buyerName: "Cliente Telefono Malo",
          phone: "x",
          email: "telmalo@example.com",
          method: "MP",
          items: [{ variantId: variant.id, qty: 1 }],
        }),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_contact");
      expect(body.field).toBe("phone");
      expect(typeof body.message).toBe("string");

      const ordersForVariant = await prisma.orderItem.findMany({ where: { variantId: variant.id } });
      expect(ordersForVariant).toHaveLength(0);
      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.held).toBe(0);
    });

    it.each([
      ["no leading 0, no area code", "385 4211234"],
      ["written with 15", "11 15 2345 6789"],
      ["with area code and leading 0", "0385 421-1234"],
      ["E.164-style with country code", "+54 9 385 4211234"],
    ])(
      "triangulation: accepts a real, inconsistently formatted AR phone (%s) — PICKUP_CASH to avoid the MP mock",
      async (_label, phone) => {
        const variant = await makeVariant(2);

        const response = await POST(
          postRequest({
            buyerName: "Cliente Telefono Real",
            phone,
            email: "telreal@example.com",
            method: "PICKUP_CASH",
            items: [{ variantId: variant.id, qty: 1 }],
          }),
        );

        expect(response.status).toBe(201);
        const body = await response.json();
        createdOrderIds.push(body.orderId);
      },
    );
  });

  it("rejects an empty cart with 400", async () => {
    const response = await POST(
      postRequest({
        buyerName: "Cliente Vacio",
        phone: "3815550003",
        email: "vacio@example.com",
        method: "MP",
        items: [],
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("empty_cart");
  });

  // 2026-08-21-checkout-antiabuso — tasks.md 3.4, design.md
  // "TooManyOpenReservationsError carries counts, not identity; route
  // composes 409 copy". specs/cart-checkout "Per-Identity Concurrent
  // Reservation Cap".
  describe("Per-identity PICKUP_CASH reservation cap — 409 (tasks.md 3.4)", () => {
    it("rejects the 4th open PICKUP_CASH reservation for the same identity with 409 and the exact Spanish copy, creating no order row and no hold", async () => {
      const suffix = randomUUID();
      const contact = {
        buyerName: "Cliente Cap Ruta",
        phone: `3815 551 ${suffix.replace(/\D/g, "").slice(0, 4).padEnd(4, "0")}`,
        email: `cap-ruta-${suffix}@example.com`,
      };

      for (let i = 0; i < 3; i++) {
        const variant = await makeVariant(2);
        const response = await POST(
          postRequest({ ...contact, method: "PICKUP_CASH", items: [{ variantId: variant.id, qty: 1 }] }),
        );
        expect(response.status).toBe(201);
        const body = await response.json();
        createdOrderIds.push(body.orderId);
      }

      const fourthVariant = await makeVariant(2);
      const response = await POST(
        postRequest({
          ...contact,
          method: "PICKUP_CASH",
          items: [{ variantId: fourthVariant.id, qty: 1 }],
        }),
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("too_many_open_reservations");
      expect(body.message).toBe(
        "Ya tenés 3 reservas para retirar en el local sin confirmar. " +
          "Pasá a retirarlas o escribinos para cancelar alguna antes de hacer una nueva.",
      );

      const ordersForFourth = await prisma.orderItem.findMany({ where: { variantId: fourthVariant.id } });
      expect(ordersForFourth).toHaveLength(0);
      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: fourthVariant.id } });
      expect(updatedVariant.held).toBe(0);
    });
  });

  // tasks.md 5.1 — preference created for the PENDING_PAYMENT order, 303
  // redirect to init_point.
  describe("MercadoPago preference creation (task 5.1)", () => {
    it("creates the order and responds 303 to the MercadoPago init_point when method=MP", async () => {
      const variant = await makeVariant(3);
      fakeCreatePreference = async (input) => {
        expect(input.orderId).toBeTruthy();
        expect(input.items[0].quantity).toBe(1);
        return { preferenceId: `pref-${input.orderId}`, initPoint: `https://mp.example.com/pay/${input.orderId}` };
      };
      const callsBefore = createPreferenceCalls;

      const response = await POST(
        postRequest({
          buyerName: "Cliente MP",
          phone: "3815550010",
          email: "mp@example.com",
          method: "MP",
          items: [{ variantId: variant.id, qty: 1 }],
        }),
      );

      expect(response.status).toBe(303);
      expect(createPreferenceCalls).toBe(callsBefore + 1);
      const location = response.headers.get("location");
      expect(location).toMatch(/^https:\/\/mp\.example\.com\/pay\//);

      const orderId = location!.split("/").pop()!;
      createdOrderIds.push(orderId);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe("PENDING_PAYMENT");
      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.held).toBe(1);
    });

    it("triangulation: PICKUP_CASH never calls MercadoPago and still returns 201 JSON", async () => {
      const variant = await makeVariant(2);
      const callsBefore = createPreferenceCalls;

      const response = await POST(
        postRequest({
          buyerName: "Cliente Pickup",
          phone: "3815550011",
          email: "pickup@example.com",
          method: "PICKUP_CASH",
          items: [{ variantId: variant.id, qty: 1 }],
        }),
      );

      expect(response.status).toBe(201);
      expect(createPreferenceCalls).toBe(callsBefore);
      const body = await response.json();
      createdOrderIds.push(body.orderId);
    });

    it("compensates (releases the hold, cancels the order) when preference creation fails", async () => {
      const variant = await makeVariant(1);
      fakeCreatePreference = async () => {
        throw new Error("MercadoPago is unreachable in this test");
      };

      const response = await POST(
        postRequest({
          buyerName: "Cliente Falla MP",
          phone: "3815550012",
          email: "fallamp@example.com",
          method: "MP",
          items: [{ variantId: variant.id, qty: 1 }],
        }),
      );

      expect(response.status).toBe(502);

      const order = await prisma.order.findFirstOrThrow({ where: { buyerName: "Cliente Falla MP" } });
      createdOrderIds.push(order.id);
      expect(order.status).toBe("CANCELLED");

      const updatedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updatedVariant.held).toBe(0);
      expect(updatedVariant.onHand).toBe(1);
    });
  });
});
