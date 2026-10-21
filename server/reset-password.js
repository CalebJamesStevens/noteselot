import { readFile } from "node:fs/promises";
import { db, transaction } from "./db.js";
import { hashPassword } from "./auth.js";
const email = process.argv[2]?.toLowerCase();
const password = (await readFile(0, "utf8")).trimEnd();
if (!email || password.length < 12 || password.length > 128) {
  console.error(
    "Usage: provide an email argument and a 12–128 character password on stdin.",
  );
  process.exit(1);
}
try {
  await transaction(async (client) => {
    const { rows } = await client.query("SELECT id FROM users WHERE email=$1", [
      email,
    ]);
    if (!rows.length) throw new Error("Account not found.");
    await client.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
      rows[0].id,
      await hashPassword(password),
    ]);
    await client.query("DELETE FROM sessions WHERE user_id=$1", [rows[0].id]);
  });
  console.log("Password reset. Existing sessions are invalidated.");
} finally {
  await db.end();
}
