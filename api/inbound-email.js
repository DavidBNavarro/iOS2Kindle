import { query } from "../lib/turso.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  var webhookSecret = process.env.SENDGRID_INBOUND_SECRET;
  if (webhookSecret) {
    var auth = req.headers["x-webhook-token"];
    if (auth !== webhookSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    var payload = req.body || {};
    var from = payload.from || "";
    var to = (payload.to || "").trim();
    var subject = payload.subject || "";
    var title = subject;

    var userResult = await query(
      "SELECT * FROM users WHERE forwarding_address = ?",
      [to]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "Unknown forwarding address: " + to });
    }

    var user = userResult.rows[0];

    var now = new Date();
    var yearMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    var usageResult = await query(
      "SELECT count FROM usage WHERE user_id = ? AND year_month = ? AND source_type = 'newsletter'",
      [user.id, yearMonth]
    );

    var currentUsage = usageResult.rows.length > 0 ? parseInt(usageResult.rows[0].count) : 0;
    if (currentUsage >= 20) {
      return res.status(429).json({ error: "Monthly limit reached", user_email: user.kindle_email });
    }

    await query(
      "INSERT INTO usage (user_id, year_month, count, source_type)\n     VALUES (?, ?, 1, 'newsletter')\n     ON CONFLICT(user_id, year_month, source_type)\n     DO UPDATE SET count = count + 1",
      [user.id, yearMonth]
    );

    await query(
      "INSERT INTO send_history (user_id, title, source_type) VALUES (?, ?, 'newsletter')",
      [user.id, title || "Untitled"]
    );

    return res.status(200).json({ success: true, title: title });
  } catch (e) {
    return res.status(500).json({ error: "Processing failed: " + e.message });
  }
};
