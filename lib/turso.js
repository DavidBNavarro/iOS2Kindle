var TURSO_URL = process.env.TURSO_DATABASE_URL;
var TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

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
  var obj = {};
  for (var i = 0; i < cols.length; i++) {
    var cell = row[i];
    obj[cols[i].name] = cell.type === "null" ? null : cell.value;
  }
  return obj;
}

async function execute(sql, args) {
  var typedArgs = (args || []).map(toTypedArg);
  var body = JSON.stringify({ requests: [{ type: "execute", stmt: { sql: sql, args: typedArgs } }] });
  var res = await fetch(dbUrl() + "/v2/pipeline", {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: body
  });
  if (!res.ok) {
    var text = await res.text();
    throw new Error("Turso error " + res.status + ": " + text);
  }
  var data = JSON.parse(await res.text());
  var result = data.results?.[0]?.response?.result;
  if (data.results?.[0]?.type === "error") {
    throw new Error("Turso query error: " + (data.results[0].response?.error?.message || "unknown"));
  }
  return result;
}

async function query(sql, args) {
  var result = await execute(sql, args);
  var cols = result?.cols || [];
  var rows = result?.rows || [];
  return { rows: rows.map(function(r) { return rowToObj(cols, r); }), lastInsertRowid: result?.last_insert_rowid };
}

export { execute, query };
