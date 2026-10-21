import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { parseCookie, stringifySetCookie } from "cookie";
import { db } from "./db.js";
const scrypt = promisify(scryptCallback);
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(":");
  const expected = Buffer.from(hex, "hex");
  const actual = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function findSession(cookieHeader = "") {
  const token = parseCookie(cookieHeader).noteselot_session;
  if (!token || token.length !== 64) return null;
  const { rows } = await db.query(
    `SELECT u.id,u.name,u.email,s.token_hash,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [hashToken(token)],
  );
  return rows[0] || null;
}
export async function issueSession(res, userId, secure) {
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions VALUES ($1,$2,now()+interval '14 days')",
    [hashToken(token), userId],
  );
  res.setHeader(
    "Set-Cookie",
    stringifySetCookie({
      name: "noteselot_session",
      value: token,
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 14 * 86400,
    }),
  );
}
export function clearSession(res, secure) {
  res.setHeader(
    "Set-Cookie",
    stringifySetCookie({
      name: "noteselot_session",
      value: "",
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }),
  );
}
