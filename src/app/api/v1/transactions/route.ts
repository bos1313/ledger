import { z } from "zod";
import { db } from "@/db";
import { formatMinorPlain } from "@/lib/csv";
import { isCurrency } from "@/lib/money";
import { json, withApi } from "@/server/api";
import { listEntries } from "@/server/ledger";

const Query = z.object({
  accountId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

/** GET /api/v1/transactions?accountId=…&page=1&pageSize=20&from=2026-01-01&format=csv */
export const GET = withApi(async (req, { userId }) => {
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const rows = await listEntries(db, { userId, ...q });

  if (q.format === "csv") {
    const header = "date,type,description,amount,currency,rate,transfer_id";
    const lines = rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.kind,
        `"${(r.description ?? "").replaceAll('"', '""')}"`,
        isCurrency(r.currency) ? formatMinorPlain(r.amountMinor, r.currency) : r.amountMinor.toString(),
        r.currency,
        r.rate,
        r.transferId,
      ].join(","),
    );
    return new Response([header, ...lines].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="transactions-${q.accountId}.csv"`,
      },
    });
  }

  return json({
    data: rows.map((r) => ({
      id: r.id,
      transfer_id: r.transferId,
      kind: r.kind,
      description: r.description,
      amount_minor: r.amountMinor,
      currency: r.currency,
      rate: r.rate,
      created_at: r.createdAt,
    })),
    page: q.page,
    page_size: q.pageSize,
  });
});
