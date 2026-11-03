import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dataTypes, db2iFieldPresets, defaultColumnType, generateSQL, normalizedType,
} from "../src/erd/dialects.ts";

function col(id, name, type, primary = false, overrides = {}) {
  return { id, name, type, primary, nullable: !primary, ...overrides };
}
function table(id, name, columns, overrides = {}) {
  return { id, name, x: 0, y: 0, columns, ...overrides };
}
function rel(parentId, parentColumn, childId, childColumn) {
  return { id: "rel", fromTable: parentId, fromColumn: parentColumn,
    toTable: childId, toColumn: childColumn, fromCard: "one", toCard: "zero-many" };
}

test("PostgreSQL remains default, supports existing types and composite primary keys", () => {
  const t = table("t1", "contacts", [
    col("c1", "id", "uuid", true),
    col("c2", "seq", "integer", true),
    col("c3", "name", "varchar(255)"),
  ]);
  const ddl = generateSQL([t], []);
  assert.match(ddl, /PostgreSQL/);
  assert.match(ddl, /"id" UUID NOT NULL/);
  assert.match(ddl, /PRIMARY KEY \("id", "seq"\)/);
  assert.match(ddl, /"name" VARCHAR\(255\)/);
});

test("Db2 for i includes qualified library, packed/zoned types, system names and CCSID", () => {
  const parent = table("p", "CustomerAccount", [
    col("pkey", "CustomerIdentifier", "BIGINT", true, { systemName: "CUSTID" }),
    col("pamt", "Amount", "DECIMAL(15,2)", false, { nullable: false }),
    col("pqty", "Quantity", "NUMERIC(9,0)"),
    col("pc", "Code", "CHAR(10)", false, { ccsid: 37 }),
  ], { systemName: "CUSTACCT" });
  const child = table("c", "OrderLines", [
    col("ck", "ID", "BIGINT", true),
    col("cfk", "CUSTID", "BIGINT"),
  ]);
  const ddl = generateSQL([parent, child], [rel("p", "pkey", "c", "cfk")], { dialect: "db2i", schema: "WEBTEST" });
  assert.match(ddl, /CREATE TABLE "WEBTEST"\."CustomerAccount" FOR SYSTEM NAME "CUSTACCT"/);
  assert.match(ddl, /"CustomerIdentifier" FOR COLUMN "CUSTID" BIGINT NOT NULL/);
  assert.match(ddl, /"Amount" DECIMAL\(15,2\) NOT NULL/);
  assert.match(ddl, /"Quantity" NUMERIC\(9,0\)/);
  assert.match(ddl, /"Code" CHAR\(10\) CCSID 37/);
  assert.match(ddl, /ALTER TABLE "WEBTEST"\."OrderLines" ADD FOREIGN KEY \("CUSTID"\) REFERENCES "WEBTEST"\."CustomerAccount" \("CustomerIdentifier"\)/);
});

test("Db2 for i helpers expose packed (P) and zoned (S) without changing PostgreSQL defaults", () => {
  assert.equal(defaultColumnType("postgres", true), "uuid");
  assert.equal(defaultColumnType("db2i", true), "BIGINT");
  assert.equal(defaultColumnType("db2i"), "VARCHAR(255)");
  assert.ok(db2iFieldPresets.some((p) => p.label.includes("Packed") && p.type.startsWith("DECIMAL")));
  assert.ok(db2iFieldPresets.some((p) => p.label.includes("Zoned") && p.type.startsWith("NUMERIC")));
  assert.ok(dataTypes.db2i.includes("VARGRAPHIC(80)"));
});

test("Db2 for i valid lengths, numeric precision and DECFLOAT options", () => {
  assert.equal(normalizedType("db2i", "decimal( 9 , 2 )".replace(/\s/g, "")), "DECIMAL(9,2)");
  assert.equal(normalizedType("db2i", "VARCHAR(255)"), "VARCHAR(255)");
  assert.equal(normalizedType("db2i", "DECFLOAT(34)"), "DECFLOAT(34)");
  assert.equal(normalizedType("db2i", "BLOB(1M)"), "BLOB(1M)");
  assert.throws(() => normalizedType("db2i", "DECIMAL(64,0)"), /between 1 and 63/);
  assert.throws(() => normalizedType("db2i", "NUMERIC(9,10)"), /scale/);
  assert.throws(() => normalizedType("db2i", "DECFLOAT(20)"), /Unsupported/);
});

test("Untrusted type declarations cannot inject SQL", () => {
  const t = table("t", "Customers", [col("c", "Id", "INTEGER); DROP TABLE users;--", true)]);
  assert.throws(() => generateSQL([t], [], { dialect: "db2i" }), /Unsupported/);
  assert.throws(() => generateSQL([t], []), /Unsupported/);
});

test("Db2 for i validates system identifiers and does not allow unnecessary FOR SYSTEM NAME", () => {
  assert.throws(() => generateSQL([table("x", "CUSTOMERS", [col("a", "ID", "BIGINT", true)], { systemName: "CUST" })], [], { dialect: "db2i" }), /FOR SYSTEM NAME requires/);
  assert.throws(() => generateSQL([table("x", "LongTableName", [col("a", "ID", "BIGINT", true)], { systemName: "TOO_LONG_NAME" })], [], { dialect: "db2i" }), /1–10/);
  assert.throws(() => generateSQL([table("x", "X", [col("a", "ID", "BIGINT", true)])], [], { dialect: "db2i", schema: "INVALID_LIBRARY" }), /1–10/);
});

test("Db2 referential constraints require matching column types and a single parent PK", () => {
  const p = table("p", "Parent", [col("pk", "ID", "BIGINT", true), col("pk2", "SEQ", "INTEGER", true)]);
  const c = table("c", "Child", [col("fk", "PARENT_ID", "BIGINT")]);
  assert.throws(() => generateSQL([p, c], [rel("p", "pk", "c", "fk")], { dialect: "db2i" }), /single-column primary key/);
  p.columns.pop();
  c.columns[0].type = "VARCHAR(255)";
  assert.throws(() => generateSQL([p, c], [rel("p", "pk", "c", "fk")], { dialect: "db2i" }), /types must match/);
});

test("Db2 rejects invalid CCSID/type pairs", () => {
  const t = table("x", "T", [col("c", "C", "INTEGER", false, { ccsid: 1208 })]);
  assert.throws(() => generateSQL([t], [], { dialect: "db2i" }), /CCSID helper supports/);
});
