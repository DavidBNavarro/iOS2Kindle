import { createClient } from "@libsql/client";

function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  return createClient({ url, authToken: token });
}

async function getUserId(db, apiKey) {
  const result = await db.execute({
    sql: "SELECT id FROM users WHERE api_key = ?",
    args: [apiKey]
  });
  return result.rows.length > 0 ? result.rows[0].id : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = req.headers["x-api-key"] || req.query?.api_key;
  if (!apiKey) return res.status(401).json({ error: "Missing API key" });

  const db = getDb();
  const userId = await getUserId(db, apiKey);
  if (!userId) return res.status(401).json({ error: "Invalid API key" });

  const now = new Date();
  const yearMonth = req.query?.year_month || (now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"));

  const result = await db.execute({
    sql: "SELECT source_type, count FROM usage WHERE user_id = ? AND year_month = ?",
    args: [userId, yearMonth]
  });

  const usage = {};
  for (const row of result.rows) {
    usage[row.source_type] = row.count;
  }

  return res.status(200).json({ usage, year_month: yearMonth, limits: { newsletter: 20 } });
}
