import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// `next build` imports route modules without runtime env; postgres-js only connects on the first query.
const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const url = process.env.DATABASE_URL ?? (isBuild ? "postgres://build-placeholder/none" : undefined);
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse one pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
const client = globalForDb.pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { client as pg };
