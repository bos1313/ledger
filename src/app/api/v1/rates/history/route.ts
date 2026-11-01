import { z } from "zod";
import { CURRENCIES } from "@/lib/money";
import { getRateHistory } from "@/lib/rates";
import { json, withApi } from "@/server/api";

const Query = z.object({
  from: z.enum(CURRENCIES),
  to: z.enum(CURRENCIES),
  days: z.coerce.number().int().min(7).max(730).default(90),
});

/** GET /api/v1/rates/history?from=EUR&to=USD&days=90 — one point per ECB working day. */
export const GET = withApi(async (req) => {
  const { from, to, days } = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const points = await getRateHistory(from, to, days);
  return json({ data: { from, to, days, points, source: "ECB via Frankfurter" } });
});
