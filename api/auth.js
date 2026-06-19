import { createClient } from "@libsql/client";

function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken: token });
}

export async function authenticate(req) {
  const apiKey = req.headers["x-api-key"] || req.body?.api_key;

  if (!apiKey || typeof apiKey !== "string") {
    return { error: "Missing API key", status: 401 };
  }

  const db = getDb();
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE api_key = ?",
    args: [apiKey.trim()]
  });

  if (result.rows.length === 0) {
    return { error: "Invalid API key", status: 401 };
  }

  return { user: result.rows[0] };
}
