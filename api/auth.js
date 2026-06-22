import { query } from "../lib/turso.js";

export async function authenticate(req) {
  const apiKey = req.headers["x-api-key"] || req.body?.api_key;

  if (!apiKey || typeof apiKey !== "string") {
    return { error: "Missing API key", status: 401 };
  }

  const result = await query("SELECT * FROM users WHERE api_key = ?", [apiKey.trim()]);

  if (result.rows.length === 0) {
    return { error: "Invalid API key", status: 401 };
  }

  return { user: result.rows[0] };
}
