const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

function dbUrl() {
  if (!TURSO_URL) throw new Error("TURSO_DATABASE_URL not set");
  return TURSO_URL.replace(/^libsql:/, "https:");
}

function authHeader() {
  if (!TURSO_TOKEN) throw new Error("TURSO_AUTH_TOKEN not set");
  return "Bearer " + TURSO_TOKEN;
}

function toTypedArg(val) {
  if (val === null || val === undefined) return { type: "null" };
  if (typeof val === "number") return { type: "integer", value: String(val) };
  if (typeof val === "bigint") return { type: "integer", value: String(val) };
  return { type: "text", value: String(val) };
}

function rowToObj(cols, row) {
  const obj = {};
  for (let i = 0; i < cols.length; i++) {
    const cell = row[i];
    obj[cols[i].name] = cell.type === "null" ? null : cell.value;
  }
  return obj;
}

async function execute(sql, args) {
  const typedArgs = (args || []).map(toTypedArg);
  const body = JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: typedArgs } }] });
  const res = await fetch(dbUrl() + "/v2/pipeline", {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Turso error " + res.status + ": " + text);
  }
  const data = JSON.parse(await res.text());
  const result = data.results?.[0]?.response?.result;
  if (data.results?.[0]?.type === "error") {
    throw new Error("Turso query error: " + (data.results[0].response?.error?.message || "unknown"));
  }
  return result;
}

async function query(sql, args) {
  const result = await execute(sql, args);
  const cols = result?.cols || [];
  const rows = result?.rows || [];
  return { rows: rows.map(r => rowToObj(cols, r)), lastInsertRowid: result?.last_insert_rowid };
}

module.exports = { execute, query };
