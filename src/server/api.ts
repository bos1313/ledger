import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { FxUnavailableError } from "@/lib/rates";
import { getSession } from "./auth";
import { LedgerError, type LedgerErrorCode } from "./ledger";

/**
 * JSON helpers for the REST API. Money goes over the wire as a string of minor units
 * ("amount_minor": "12345"), because JSON numbers become JS floats on the client.
 */
export function json(data: unknown, init?: ResponseInit) {
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
}

export function apiError(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

const STATUS: Record<LedgerErrorCode, number> = {
  NOT_FOUND: 404,
  SAME_ACCOUNT: 422,
  INVALID_AMOUNT: 422,
  INSUFFICIENT_FUNDS: 422,
  IDEMPOTENCY_CONFLICT: 409,
};

type Handler<C> = (req: Request, ctx: C & { userId: string }) => Promise<Response>;

/** Wraps a route handler with auth + consistent error mapping. */
export function withApi<C = object>(handler: Handler<C>) {
  return async (req: Request, ctx: C) => {
    const session = await getSession();
    if (!session) return apiError(401, "UNAUTHENTICATED", "Login required");
    try {
      return await handler(req, { ...ctx, userId: session.userId });
    } catch (e) {
      if (e instanceof LedgerError) return apiError(STATUS[e.code], e.code, e.message);
      if (e instanceof ZodError) return apiError(400, "VALIDATION_ERROR", e.issues.map((i) => i.message).join("; "));
      if (e instanceof FxUnavailableError) return apiError(503, "FX_UNAVAILABLE", "Exchange rates are temporarily unavailable");
      console.error(e);
      return apiError(500, "INTERNAL", "Unexpected error");
    }
  };
}
