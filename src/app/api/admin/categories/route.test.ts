import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";

// HTTP-level tests for the admin category-creation route — thin wiring over
// src/modules/catalog/category.service.ts's createCategory() (design.md
// D1/C1-C4). Mirrors api/admin/products/route.test.ts's conventions: mocked
// auth() + real Postgres. Backs specs/admin-console/spec.md "Authenticated
// Access" (standalone /api/admin/* route, own session check) and "Product
// and Variant Management" (category creation, slug validation, duplicate
// rejection). tasks.md 3.1/3.2.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/categories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/categories (integration, real Postgres)", () => {
  const createdCategoryIds: string[] = [];

  afterAll(async () => {
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  });

  it("rejects an unauthenticated request with 401 and writes nothing to the DB", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const suffix = randomUUID();

    const response = await POST(
      jsonRequest({ name: "Sin Auth", slug: `sin-auth-${suffix}` }),
    );

    expect(response.status).toBe(401);
    const found = await prisma.category.findUnique({ where: { slug: `sin-auth-${suffix}` } });
    expect(found).toBeNull();
  });

  it("rejects a missing name with 400 invalid_request", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const suffix = randomUUID();

    const response = await POST(jsonRequest({ slug: `no-name-${suffix}` }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects an empty-string name with 400 invalid_request", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const suffix = randomUUID();

    const response = await POST(jsonRequest({ name: "   ", slug: `empty-name-${suffix}` }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects a missing slug with 400 invalid_request", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const response = await POST(jsonRequest({ name: "Sin Slug" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects a slug with spaces (Ropa Interior) with 400 invalid_slug before any DB call", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const countBefore = await prisma.category.count();
    const response = await POST(jsonRequest({ name: "Ropa Interior", slug: "Ropa Interior" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_slug");
    const countAfter = await prisma.category.count();
    expect(countAfter).toBe(countBefore);
  });

  it("rejects an accented slug (Bijoutería) with 400 invalid_slug before any DB call", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());

    const countBefore = await prisma.category.count();
    const response = await POST(jsonRequest({ name: "Bijoutería", slug: "Bijoutería" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_slug");
    const countAfter = await prisma.category.count();
    expect(countAfter).toBe(countBefore);
  });

  it("returns 409 duplicate_slug with a readable message and writes nothing new on a duplicate slug", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const suffix = randomUUID();
    const slug = `bijouteria-dup-${suffix}`;

    const first = await POST(jsonRequest({ name: "Bijouteria", slug }));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    createdCategoryIds.push(firstBody.id);

    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const countBefore = await prisma.category.count({ where: { slug } });

    const second = await POST(jsonRequest({ name: "Bijouteria Otra Vez", slug }));

    expect(second.status).toBe(409);
    const secondBody = await second.json();
    expect(secondBody.error).toBe("duplicate_slug");
    expect(typeof secondBody.message).toBe("string");
    expect(secondBody.message.length).toBeGreaterThan(0);

    const countAfter = await prisma.category.count({ where: { slug } });
    expect(countAfter).toBe(countBefore);
  });

  it("returns 201 with the full createCategory row (id, name, slug, createdAt, updatedAt) on success", async () => {
    mockedAuth.mockResolvedValueOnce(fakeAdminSession());
    const suffix = randomUUID();
    const slug = `calzado-full-${suffix}`;

    const response = await POST(jsonRequest({ name: "Calzado", slug }));

    expect(response.status).toBe(201);
    const body = await response.json();
    createdCategoryIds.push(body.id);

    expect(typeof body.id).toBe("string");
    expect(body.name).toBe("Calzado");
    expect(body.slug).toBe(slug);
    expect(typeof body.createdAt).toBe("string");
    expect(typeof body.updatedAt).toBe("string");
  });
});
