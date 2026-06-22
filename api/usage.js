import { query } from "../lib/turso.js";

export default async function handler(req, res) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  try {
    const userResult = await query("SELECT id, kindle_email, forwarding_address FROM users WHERE api_key = ?", [apiKey]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    const user = userResult.rows[0];

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const now = new Date();
    const yearMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const usageResult = await query(
      "SELECT source_type, count FROM usage WHERE user_id = ? AND year_month = ?",
      [user.id, yearMonth]
    );

    const usage = {};
    const limits = { newsletter: 20, extension: 50 };
    for (const row of usageResult.rows) {
      usage[row.source_type] = row.count;
    }

    return res.status(200).json({
      usage,
      limits,
      user: { kindle_email: user.kindle_email, forwarding_address: user.forwarding_address }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
