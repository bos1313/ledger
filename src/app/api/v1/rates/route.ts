import { z } from "zod";
import { CURRENCIES } from "@/lib/money";
import { getRate } from "@/lib/rates";
import { json, withApi } from "@/server/api";

const Query = z.object({ from: z.enum(CURRENCIES), to: z.enum(CURRENCIES) });

/** GET /api/v1/rates?from=EUR&to=USD */
export const GET = withApi(async (req) => {
  const { from, to } = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { rate, date } = await getRate(from, to);
  return json({ data: { from, to, rate, date, source: "ECB via Frankfurter" } });
});
