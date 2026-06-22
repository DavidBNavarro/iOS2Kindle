import { createClient } from "@libsql/client/web";

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
  const apiKey = req.headers["x-api-key"] || req.body?.api_key;
  if (!apiKey) return res.status(401).json({ error: "Missing API key" });

  const db = getDb();
  const userId = await getUserId(db, apiKey);
  if (!userId) return res.status(401).json({ error: "Invalid API key" });

  if (req.method === "GET") {
    const limit = parseInt(req.query?.limit || "50");
    const result = await db.execute({
      sql: "SELECT * FROM send_history WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?",
      args: [userId, limit]
    });
    return res.status(200).json({ history: result.rows });
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "id is required" });
    await db.execute({
      sql: "DELETE FROM send_history WHERE id = ? AND user_id = ?",
      args: [id, userId]
    });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
