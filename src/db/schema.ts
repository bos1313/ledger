import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  char,
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accountKind = pgEnum("account_kind", ["user", "system"]);
export const transferKind = pgEnum("transfer_kind", ["transfer", "deposit"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * User accounts hold customer money. System accounts are the "other side" of the books:
 *  - external:<CCY>  money entering from outside (Stripe deposits, seed opening balances)
 *  - fx:<CCY>        currency-exchange position; balances cross-currency transfers
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    kind: accountKind("kind").notNull().default("user"),
    code: text("code"), // set for system accounts, e.g. "fx:EUR"
    name: text("name").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_code_uq").on(t.code),
    uniqueIndex("accounts_user_currency_uq").on(t.userId, t.currency),
    check(
      "accounts_owner_ck",
      sql`(${t.kind} = 'user' AND ${t.userId} IS NOT NULL) OR (${t.kind} = 'system' AND ${t.code} IS NOT NULL)`,
    ),
  ],
);

/**
 * One business event (a transfer or a deposit). The idempotency key is unique per user,
 * so a retried request returns the original transfer instead of posting it twice.
 */
export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: transferKind("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(), // detects key reuse with a different body
    fromAccountId: uuid("from_account_id").references(() => accounts.id),
    toAccountId: uuid("to_account_id").notNull().references(() => accounts.id),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(), // in source currency
    convertedMinor: bigint("converted_minor", { mode: "bigint" }).notNull(), // in target currency
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    rateDate: text("rate_date"),
    description: text("description"),
    externalRef: text("external_ref"), // e.g. Stripe PaymentIntent id
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transfers_idempotency_uq").on(t.userId, t.idempotencyKey),
    uniqueIndex("transfers_external_ref_uq").on(t.externalRef),
    check("transfers_amount_positive_ck", sql`${t.amountMinor} > 0 AND ${t.convertedMinor} > 0`),
  ],
);

/**
 * Double-entry ledger. Append-only: rows are never updated or deleted.
 * Invariant: for every transfer, entries sum to zero *per currency*.
 * An account's balance is SUM(amount_minor) of its entries.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    transferId: uuid("transfer_id").notNull().references(() => transfers.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(), // signed: + in, - out
    currency: char("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_account_created_idx").on(t.accountId, t.createdAt),
    index("ledger_entries_transfer_idx").on(t.transferId),
    check("ledger_entries_nonzero_ck", sql`${t.amountMinor} <> 0`),
  ],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Transfer = typeof transfers.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
