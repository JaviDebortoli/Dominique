// @vitest-environment node
//
// Runs under Node's native Request/FormData/File (not jsdom's) — this route
// handler parses real multipart bodies via request.formData(), and jsdom's
// File/FormData implementation does not round-trip through Request bodies
// the same way Node's built-in (undici) ones do, which the tests below
// depend on for realistic multipart parsing (as Next.js's actual runtime
// does). @/lib/auth is still mocked, so next-auth is never loaded here.
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asMockedAuth, fakeAdminSession, makeAuthMockModule } from "@/lib/testing/admin-auth-mock";

// tasks.md 7.4/7.5 — design.md Threat Matrix row "Documentation-like /
// executable-file classification": "Allow-list image/jpeg,png,webp by
// magic bytes (not extension), re-encode via sharp, random filename... ⇒
// rejected, nothing written" for anything else. THIS FILE'S FIRST describe
// block (7.4) is the RED test, written and run failing BEFORE route.ts
// existed — see the RED evidence captured in this session's apply-progress.
//
// `@/lib/auth` is mocked (same pattern as the products route test) so this
// test never depends on next-auth's session-cookie machinery.
vi.mock("@/lib/auth", () => makeAuthMockModule());

const { auth } = await import("@/lib/auth");
const mockedAuth = asMockedAuth(auth);
const { POST } = await import("./route");

// The exact directory route.ts writes to for local dev (see that file's
// module doc for the D8 production-vs-dev-adaptation note). Used here only
// to assert "nothing written" — never asserted against directly by
// production code, which only ever returns a URL.
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "products");

function listUploadFiles(): string[] {
  return existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR) : [];
}

function uploadRequest(file: File): Request {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://localhost/api/admin/upload", { method: "POST", body: form });
}

describe("POST /api/admin/upload", () => {
  const filesToCleanUp: string[] = [];

  beforeAll(() => {
    mockedAuth.mockResolvedValue(fakeAdminSession());
  });

  afterAll(() => {
    for (const name of filesToCleanUp) {
      const full = path.join(UPLOAD_DIR, name);
      if (existsSync(full)) rmSync(full);
    }
  });

  it("rejects an unauthenticated request with 401 before even reading the body", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const before = listUploadFiles();

    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    const response = await POST(uploadRequest(file));

    expect(response.status).toBe(401);
    expect(listUploadFiles()).toEqual(before);
  });

  describe("threat matrix — rejected file types, nothing written to disk (tasks.md 7.4, RED-first)", () => {
    it("rejects an .svg file (XML text, no image magic bytes)", async () => {
      const before = listUploadFiles();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
      const file = new File([svg], "logo.svg", { type: "image/svg+xml" });

      const response = await POST(uploadRequest(file));

      expect(response.status).toBe(415);
      expect(listUploadFiles()).toEqual(before);
    });

    it("rejects an .html file", async () => {
      const before = listUploadFiles();
      const file = new File(["<html><body>hi</body></html>"], "page.html", {
        type: "text/html",
      });

      const response = await POST(uploadRequest(file));

      expect(response.status).toBe(415);
      expect(listUploadFiles()).toEqual(before);
    });

    it("rejects a .php file", async () => {
      const before = listUploadFiles();
      const file = new File(["<?php system($_GET['c']); ?>"], "shell.php", {
        type: "application/x-httpd-php",
      });

      const response = await POST(uploadRequest(file));

      expect(response.status).toBe(415);
      expect(listUploadFiles()).toEqual(before);
    });

    it("rejects a JPEG-renamed HTML file — actual bytes are sniffed, filename extension and client Content-Type are NEVER trusted", async () => {
      const before = listUploadFiles();
      // Named and labeled exactly like a real photo upload would be, but
      // the ACTUAL bytes are HTML — this is the precise attack the magic
      // -byte allow-list defends against.
      const file = new File(["<html><body><script>alert(document.cookie)</script></body></html>"], "photo.jpg", {
        type: "image/jpeg",
      });

      const response = await POST(uploadRequest(file));

      expect(response.status).toBe(415);
      expect(listUploadFiles()).toEqual(before);
    });

    it("rejects a truncated/corrupt file whose first bytes happen to match nothing recognizable", async () => {
      const before = listUploadFiles();
      const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])], "junk.jpg", {
        type: "image/jpeg",
      });

      const response = await POST(uploadRequest(file));

      expect(response.status).toBe(415);
      expect(listUploadFiles()).toEqual(before);
    });
  });

  describe("allow-list — accepted image types, re-encoded, random filename (tasks.md 7.5, GREEN)", () => {
    it("accepts a real PNG, re-encodes it via sharp, and stores it under a random filename", async () => {
      const pngBuffer = await sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 100, b: 50 } },
      })
        .png()
        .toBuffer();
      // Client-declared filename/type are attacker-controlled and must be
      // ignored for the STORED name — only the sniffed real format matters.
      const file = new File([pngBuffer], "not-what-it-says.exe", { type: "application/octet-stream" });

      const response = await POST(uploadRequest(file));

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(typeof body.url).toBe("string");
      expect(body.url).toMatch(/^\/uploads\/products\/[a-f0-9-]+\.png$/);
      expect(body.url).not.toContain("not-what-it-says");

      const savedName = path.basename(body.url);
      filesToCleanUp.push(savedName);
      expect(existsSync(path.join(UPLOAD_DIR, savedName))).toBe(true);
    });

    it("accepts a real JPEG and re-encodes it (strips any embedded metadata/scripting)", async () => {
      const jpegBuffer = await sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 200, b: 10 } },
      })
        .jpeg()
        .toBuffer();
      const file = new File([jpegBuffer], "photo.jpg", { type: "image/jpeg" });

      const response = await POST(uploadRequest(file));

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.url).toMatch(/^\/uploads\/products\/[a-f0-9-]+\.jpe?g$/);

      const savedName = path.basename(body.url);
      filesToCleanUp.push(savedName);

      // The re-encode strips scripting/metadata: prove the ON-DISK bytes
      // are a plain re-encoded JPEG that sharp can read back cleanly.
      const roundTrip = await sharp(path.join(UPLOAD_DIR, savedName)).metadata();
      expect(roundTrip.format).toBe("jpeg");
    });

    it("rejects a request with no file field", async () => {
      const before = listUploadFiles();
      const form = new FormData();
      const response = await POST(
        new Request("http://localhost/api/admin/upload", { method: "POST", body: form }),
      );

      expect(response.status).toBe(400);
      expect(listUploadFiles()).toEqual(before);
    });
  });

  describe("UPLOAD_DIR override (tasks.md 8.1, D8 production path)", () => {
    it("writes under $UPLOAD_DIR/products instead of public/uploads/products when UPLOAD_DIR is set, while the returned URL stays /uploads/products/* for Nginx's alias", async () => {
      const overrideRoot = path.join(process.cwd(), ".tmp-upload-dir-test");
      const overrideProductsDir = path.join(overrideRoot, "products");
      process.env.UPLOAD_DIR = overrideRoot;

      try {
        const pngBuffer = await sharp({
          create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
        })
          .png()
          .toBuffer();
        const file = new File([pngBuffer], "whatever.png", { type: "image/png" });

        const response = await POST(uploadRequest(file));

        expect(response.status).toBe(201);
        const body = await response.json();
        // Public URL is stable regardless of on-disk location — Nginx's
        // `/uploads/` alias (deploy/nginx.conf) is what actually points at
        // the real production directory.
        expect(body.url).toMatch(/^\/uploads\/products\/[a-f0-9-]+\.png$/);

        const savedName = path.basename(body.url);
        expect(existsSync(path.join(overrideProductsDir, savedName))).toBe(true);
        // Never fell back to the default dev directory while the override
        // was set.
        expect(existsSync(path.join(UPLOAD_DIR, savedName))).toBe(false);
      } finally {
        delete process.env.UPLOAD_DIR;
        rmSync(overrideRoot, { recursive: true, force: true });
      }
    });
  });
});
