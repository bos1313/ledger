import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/** Public liveness + DB check, used by Docker healthcheck and uptime monitors. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "db_unavailable" }, { status: 503 });
  }
}
