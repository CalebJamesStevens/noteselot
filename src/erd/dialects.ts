export type Dialect = "postgres" | "db2i";
export type Cardinality = "one" | "zero-one" | "many" | "zero-many";
export type Column = { id: string; name: string; type: string; primary: boolean; nullable: boolean; systemName?: string; ccsid?: number };
export type Table = { id: string; name: string; x: number; y: number; w: number; h: number; columns: Column[]; systemName?: string };
export type Relation = { id: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string; fromCard: Cardinality; toCard: Cardinality };
export type DesignOptions = { dialect?: Dialect; schema?: string };

export const dataTypes: Record<Dialect, string[]> = {
  postgres: ["uuid", "text", "varchar(255)", "char(10)", "integer", "bigint", "smallint", "boolean", "date", "time", "timestamp", "timestamptz", "numeric(12,2)", "jsonb", "bytea"],
  db2i: ["BIGINT", "INTEGER", "SMALLINT", "CHAR(10)", "VARCHAR(255)", "DECIMAL(9,2)", "NUMERIC(9,2)", "DECFLOAT(16)", "DECFLOAT(34)", "DATE", "TIME", "TIMESTAMP", "BOOLEAN", "GRAPHIC(10)", "VARGRAPHIC(80)", "BINARY(16)", "VARBINARY(255)", "CLOB(1M)", "BLOB(1M)"],
};
export const db2iFieldPresets = [
  { name: "amount", type: "DECIMAL(15,2)", label: "Packed decimal (DDS P)" },
  { name: "quantity", type: "NUMERIC(9,0)", label: "Zoned decimal (DDS S)" },
  { name: "code", type: "CHAR(10)", label: "Fixed character (DDS A)" },
  { name: "description", type: "VARCHAR(255)", label: "Variable text" },
  { name: "effective_date", type: "DATE", label: "SQL date" },
  { name: "last_changed", type: "TIMESTAMP", label: "Timestamp" },
  { name: "status", type: "CHAR(1)", label: "Single-character status" },
] as const;
export function defaultColumnType(dialect: Dialect, primary = false): string {
  return dialect === "db2i" ? (primary ? "BIGINT" : "VARCHAR(255)") : (primary ? "uuid" : "text");
}
export function quoteIdentifier(value: string): string {
  if (!value.trim() || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("SQL identifiers must have 1–128 visible characters.");
  return '"' + value.replace(/"/g, '""') + '"';
}
function positiveLength(raw: string, max: number, type: string): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(type + " length must be between 1 and " + max + ".");
  return n;
}
/** Whitelist scalar SQL types. Never put user-supplied type fragments directly into DDL. */
export function normalizedType(dialect: Dialect, value: string): string {
  const type = value.trim().replace(/\s+/g, " ").toUpperCase();
  const pg = ["UUID", "TEXT", "SMALLINT", "INTEGER", "INT", "BIGINT", "BOOLEAN", "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "JSONB", "BYTEA"];
  const db2 = ["SMALLINT", "INTEGER", "INT", "BIGINT", "REAL", "DOUBLE", "DOUBLE PRECISION", "DATE", "TIME", "TIMESTAMP", "BOOLEAN"];
  if ((dialect === "db2i" ? db2 : pg).includes(type)) return type;
  const size = /^(CHAR|VARCHAR|GRAPHIC|VARGRAPHIC|BINARY|VARBINARY)\((\d+)\)$/.exec(type);
  if (size) {
    const [, kind, raw] = size;
    if (dialect === "postgres" && !["CHAR", "VARCHAR"].includes(kind)) throw new Error("Unsupported PostgreSQL type: " + type);
    const max = kind === "VARCHAR" || kind === "VARBINARY" ? 32739 : kind === "VARGRAPHIC" ? 16369 : 32765;
    return kind + "(" + positiveLength(raw, dialect === "postgres" ? 10485760 : max, kind) + ")";
  }
  const decimal = /^(DECIMAL|NUMERIC)\((\d+)(?:,(\d+))?\)$/.exec(type);
  if (decimal) {
    const precision = positiveLength(decimal[2], dialect === "db2i" ? 63 : 1000, "Numeric precision");
    const scale = Number(decimal[3] ?? 0);
    if (!Number.isSafeInteger(scale) || scale < 0 || scale > precision) throw new Error("Numeric scale must be between 0 and precision.");
    return decimal[1] + "(" + precision + "," + scale + ")";
  }
  if (dialect === "db2i" && /^DECFLOAT\((16|34)\)$/.test(type)) return type;
  const lob = /^(BLOB|CLOB)\((\d+)([KMG])?\)$/.exec(type);
  if (dialect === "db2i" && lob) {
    const n = positiveLength(lob[2], lob[3] === "G" ? 1 : lob[3] === "M" ? 2047 : 2147483647, lob[1]);
    return lob[1] + "(" + n + (lob[3] || "") + ")";
  }
  throw new Error("Unsupported " + (dialect === "db2i" ? "Db2 for i" : "PostgreSQL") + " data type: " + value + ".");
}
function systemIdentifier(name: string, subject: string): string {
  const v = name.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,9}$/.test(v)) throw new Error(subject + " must be 1–10 characters, begin with a letter, and use only letters, digits and underscores.");
  return quoteIdentifier(v);
}
function nativeSystemName(name: string): boolean { return /^[A-Z][A-Z0-9_]{0,9}$/.test(name.toUpperCase()); }
function qualifiedName(table: Table, dialect: Dialect, schema: string): string {
  return (dialect === "db2i" && schema ? quoteIdentifier(schema.toUpperCase()) + "." : "") + quoteIdentifier(table.name);
}
export function generateSQL(tables: Table[], relations: Relation[], opts: DesignOptions = {}): string {
  const dialect: Dialect = opts.dialect === "db2i" ? "db2i" : "postgres";
  const schema = (opts.schema || "").trim();
  if (!tables.length) throw new Error("Create at least one table before exporting SQL.");
  if (schema && dialect === "db2i") systemIdentifier(schema, "IBM i library/schema");
  const statements = [
    "-- Noteselot database design: " + (dialect === "db2i" ? "Db2 for i (SQL naming)" : "PostgreSQL"),
    "-- Planning DDL only. Review types, constraints, and target environment before execution.",
  ];
  const names = new Set<string>();
  for (const table of tables) {
    const nameKey = table.name.toUpperCase();
    if (names.has(nameKey)) throw new Error("Duplicate table name: " + table.name);
    names.add(nameKey);
    if (!table.columns.length) throw new Error("Table " + table.name + " must have at least one column.");
    const colNames = new Set<string>();
    const systemNames = new Set<string>();
    const definitions: string[] = [];
    const pks: string[] = [];
    for (const col of table.columns) {
      const colKey = col.name.toUpperCase();
      if (colNames.has(colKey)) throw new Error("Duplicate column " + col.name + " in " + table.name);
      colNames.add(colKey);
      let definition = "  " + quoteIdentifier(col.name);
      if (dialect === "db2i" && col.systemName?.trim()) {
        const systemName = col.systemName.trim().toUpperCase();
        if (systemNames.has(systemName)) throw new Error("Duplicate IBM i column name " + systemName);
        systemNames.add(systemName);
        definition += " FOR COLUMN " + systemIdentifier(systemName, "System column name");
      }
      const type = normalizedType(dialect, col.type);
      definition += " " + type;
      if (col.ccsid != null && dialect === "db2i") {
        if (!/^(CHAR|VARCHAR)\(/.test(type)) throw new Error("The CCSID helper supports CHAR and VARCHAR only.");
        if (![37, 500, 1208, 65535].includes(col.ccsid)) throw new Error("Unsupported CCSID " + col.ccsid);
        definition += " CCSID " + col.ccsid;
      }
      if (col.primary || !col.nullable) definition += " NOT NULL";
      if (col.primary) pks.push(quoteIdentifier(col.name));
      definitions.push(definition);
    }
    if (pks.length) definitions.push("  PRIMARY KEY (" + pks.join(", ") + ")");
    let stmt = "CREATE TABLE " + qualifiedName(table, dialect, schema);
    if (dialect === "db2i" && table.systemName?.trim()) {
      if (nativeSystemName(table.name)) throw new Error("FOR SYSTEM NAME requires a SQL table name that is not already a valid IBM i system name: " + table.name);
      stmt += " FOR SYSTEM NAME " + systemIdentifier(table.systemName, "System object name");
    }
    statements.push(stmt + " (\n" + definitions.join(",\n") + "\n);");
  }
  for (const rel of relations) {
    const parent = tables.find((t) => t.id === rel.fromTable);
    const child = tables.find((t) => t.id === rel.toTable);
    if (!parent || !child) throw new Error("Relationship refers to a missing table.");
    const p = parent.columns.find((c) => c.id === rel.fromColumn);
    const c = child.columns.find((v) => v.id === rel.toColumn);
    if (!p || !c) throw new Error("Relationship refers to a missing column.");
    const keys = parent.columns.filter((col) => col.primary);
    if (keys.length !== 1 || keys[0].id !== p.id) throw new Error("Relationship target " + parent.name + "." + p.name + " must be a single-column primary key. Composite relationships are not supported yet.");
    if (normalizedType(dialect, p.type) !== normalizedType(dialect, c.type)) throw new Error("Foreign key types must match: " + parent.name + "." + p.name + " and " + child.name + "." + c.name);
    if (dialect === "db2i" && (p.ccsid ?? null) !== (c.ccsid ?? null)) throw new Error("Db2 for i foreign key CCSIDs must match.");
    statements.push("ALTER TABLE " + qualifiedName(child, dialect, schema) +
      " ADD FOREIGN KEY (" + quoteIdentifier(c.name) + ") REFERENCES " +
      qualifiedName(parent, dialect, schema) + " (" + quoteIdentifier(p.name) + ");");
  }
  return statements.join("\n\n") + "\n";
}
