import { query } from "../lib/turso.js";
import crypto from "crypto";

async function createUser(kindleEmail) {
  var id = crypto.randomUUID();
  var apiKey = "w2k_" + crypto.randomBytes(12).toString("hex");
  var slug = crypto.randomBytes(4).toString("hex");
  var domain = process.env.INBOUND_DOMAIN || "inbound.web2reader.com";
  var forwardingAddress = "wk-" + slug + "@" + domain;

  await query("INSERT INTO users (id, api_key, kindle_email, forwarding_address) VALUES (?, ?, ?, ?)",
    [id, apiKey, kindleEmail, forwardingAddress]);

  return { id: id, api_key: apiKey, forwarding_address: forwardingAddress, kindle_email: kindleEmail };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  var kindle_email = (req.body || {}).kindle_email;

  if (!kindle_email || typeof kindle_email !== "string" || !kindle_email.includes("@")) {
    return res.status(400).json({ error: "Valid kindle_email is required" });
  }

  try {
    await query("CREATE TABLE IF NOT EXISTS users (\n      id TEXT PRIMARY KEY,\n      api_key TEXT UNIQUE NOT NULL,\n      kindle_email TEXT NOT NULL,\n      forwarding_address TEXT UNIQUE NOT NULL,\n      created_at TEXT DEFAULT (datetime('now'))\n    )", []);

    var user = await createUser(kindle_email.trim().toLowerCase());

    return res.status(201).json({
      api_key: user.api_key,
      forwarding_address: user.forwarding_address,
      kindle_email: user.kindle_email
    });
  } catch (e) {
    return res.status(500).json({ error: "Registration failed: " + e.message });
  }
};
