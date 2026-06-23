import { query } from "../lib/turso.js";

async function authenticate(req) {
  var apiKey = req.headers["x-api-key"];

  if (!apiKey || typeof apiKey !== "string") {
    return { error: "Missing API key", status: 401 };
  }

  var result = await query("SELECT * FROM users WHERE api_key = ?", [apiKey.trim()]);

  if (result.rows.length === 0) {
    return { error: "Invalid API key", status: 401 };
  }

  return { user: result.rows[0] };
}

export { authenticate };
