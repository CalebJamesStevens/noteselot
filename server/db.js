import pg from "pg";
import { readFile } from "node:fs/promises";
export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE || 10),
});
export async function migrate() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(847201)");
    await client.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function transaction(run) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function canAccess(userId, noteId) {
  const { rows } = await db.query(
    `SELECT n.* FROM notes n WHERE n.id=$1 AND n.deleted_at IS NULL AND
    ((n.team_id IS NULL AND n.owner_id=$2) OR EXISTS (SELECT 1 FROM members m WHERE m.team_id=n.team_id AND m.user_id=$2))`,
    [noteId, userId],
  );
  return rows[0];
}
