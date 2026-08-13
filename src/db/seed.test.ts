import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { seedStoreHours } from "../../prisma/seed";

describe("seedStoreHours (integration, real Postgres)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("seeds Monday-Friday open, Saturday/Sunday closed, and no holidays", async () => {
    await seedStoreHours(prisma);

    const hours = await prisma.storeHours.findMany({
      orderBy: { weekday: "asc" },
    });

    expect(hours).toHaveLength(7);

    // JS Date#getDay convention: 0 = Sunday ... 6 = Saturday.
    const byWeekday = new Map(hours.map((h) => [h.weekday, h]));

    expect(byWeekday.get(0)?.closed).toBe(true); // Sunday
    for (const weekday of [1, 2, 3, 4, 5]) {
      expect(byWeekday.get(weekday)?.closed).toBe(false); // Mon-Fri
    }
    expect(byWeekday.get(6)?.closed).toBe(true); // Saturday

    const holidayCount = await prisma.holiday.count();
    expect(holidayCount).toBe(0);
  });
});
