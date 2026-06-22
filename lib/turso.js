function dbUrl() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL not set");
  return url.replace(/^libsql:/, "https:");
}

function authHeader() {
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!token) throw new Error("TURSO_AUTH_TOKEN not set");
  return "Bearer " + token;
}

function rowToObj(cols, row) {
  const obj = {};
  for (let i = 0; i < cols.length; i++) {
    obj[cols[i].name] = row[i].value;
  }
  return obj;
}

async function execute(sql, args) {
  const body = JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: args || [] } }] });
  const res = await fetch(dbUrl() + "/v2/pipeline", {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Turso error " + res.status + ": " + text);
  }
  const data = await res.json();
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

export { execute, query };
