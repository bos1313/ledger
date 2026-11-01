import { z } from "zod";
import { db } from "@/db";
import { getRate } from "@/lib/rates";
import { apiError, json, withApi } from "@/server/api";
import { postTransfer } from "@/server/ledger";

const Body = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  // Minor units as a string or integer: "1050" = 10.50
  amount_minor: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform((v) => BigInt(v)),
  description: z.string().max(140).optional(),
});

/**
 * POST /api/v1/transfers
 * Header `Idempotency-Key: <uuid>` is required. Replays return 200 with the original transfer.
 */
export const POST = withApi(async (req, { userId }) => {
  const key = req.headers.get("idempotency-key");
  if (!key || key.length > 100) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header");

  const body = Body.parse(await req.json());
  const { transfer, replayed } = await postTransfer(db, getRate, {
    userId,
    idempotencyKey: key,
    fromAccountId: body.from_account_id,
    toAccountId: body.to_account_id,
    amountMinor: body.amount_minor,
    description: body.description,
  });

  return json(
    {
      data: {
        id: transfer.id,
        from_account_id: transfer.fromAccountId,
        to_account_id: transfer.toAccountId,
        amount_minor: transfer.amountMinor,
        converted_minor: transfer.convertedMinor,
        rate: transfer.rate,
        rate_date: transfer.rateDate,
        created_at: transfer.createdAt,
      },
    },
    { status: replayed ? 200 : 201, headers: replayed ? { "idempotent-replayed": "true" } : undefined },
  );
});
