import { z } from "zod";
import { db } from "@/db";
import { entriesToCsv } from "@/lib/csv";
import { apiError, json, withApi } from "@/server/api";
import { listEntries } from "@/server/ledger";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const Query = z.object({
  accountId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: date.optional(),
  to: date.optional(),
  kind: z.enum(["transfer", "deposit"]).optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

/**
 * GET /api/v1/transactions?accountId=…&page=1&pageSize=20&from=2026-01-01&to=2026-01-31&kind=transfer
 * Dates are inclusive, in Europe/Zagreb. `format=csv` exports every matching row (no paging).
 */
export const GET = withApi(async (req, { userId }) => {
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const result = await listEntries(db, { userId, ...q, all: q.format === "csv" });
  if (!result) return apiError(404, "NOT_FOUND", "Account not found");

  if (q.format === "csv") {
    const range = [q.from, q.to].filter(Boolean).join("_to_") || "all";
    return new Response(entriesToCsv(result.rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="transactions-${range}.csv"`,
      },
    });
  }

  return json({
    data: result.rows.map((r) => ({
      id: r.id,
      transfer_id: r.transferId,
      kind: r.kind,
      description: r.description,
      amount_minor: r.amountMinor,
      balance_after_minor: r.balanceAfterMinor,
      currency: r.currency,
      rate: r.rate,
      created_at: r.createdAt,
    })),
    page: q.page,
    page_size: q.pageSize,
    total: result.total,
  });
});
