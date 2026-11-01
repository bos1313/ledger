/**
 * Creates the dev and test databases if they don't exist yet.
 * Cross-platform replacement for `createdb`, which often isn't on PATH on Windows.
 */
import postgres from "postgres";

for (const name of ["DATABASE_URL", "TEST_DATABASE_URL"] as const) {
  const value = process.env[name];
  if (!value) {
    console.log(`${name} not set, skipping`);
    continue;
  }
  const url = new URL(value);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  url.pathname = "/postgres"; // connect to the default maintenance DB
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const [row] = await admin`select 1 as ok from pg_database where datname = ${dbName}`;
    if (row) {
      console.log(`Database "${dbName}" already exists`);
    } else {
      await admin.unsafe(`create database "${dbName.replaceAll('"', '""')}"`);
      console.log(`Created database "${dbName}"`);
    }
  } catch (e) {
    console.error(`Could not connect with ${name}. Is PostgreSQL running and is the password in .env correct?`);
    throw e;
  } finally {
    await admin.end();
  }
}
