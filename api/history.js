import { query } from "../lib/turso.js";

export default async function handler(req, res) {
  var apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  try {
    var userResult = await query("SELECT id FROM users WHERE api_key = ?", [apiKey]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    var userId = userResult.rows[0].id;

    if (req.method === "GET") {
      var historyResult = await query(
        "SELECT * FROM send_history WHERE user_id = ? ORDER BY sent_at DESC, id DESC LIMIT 50",
        [userId]
      );
      return res.status(200).json({ history: historyResult.rows });
    }

    if (req.method === "DELETE") {
      var id = (req.body || {}).id;
      if (!id) {
        return res.status(400).json({ error: "Missing history entry id" });
      }
      await query("DELETE FROM send_history WHERE id = ? AND user_id = ?", [id, userId]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: "Internal error" });
  }
};
