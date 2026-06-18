// Vercel serverless function for AI article summarization
// Deploy to Vercel at web2kindle-verify.vercel.app
// Set GEMINI_API_KEY env var in Vercel dashboard (Google AI Studio key)
// Set LICENSE_HMAC_SECRET env var (same as verify.js)

import crypto from "crypto";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent";
const SECRET = process.env.LICENSE_HMAC_SECRET || "dev-secret-change-in-production";
const API_KEY = process.env.GEMINI_API_KEY || "";

function verifyLicense(key) {
  var match = key.match(/^WK-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  if (!match) return false;
  var payload = match[1] + "-" + match[2];
  var sig = match[3];
  var expected = crypto.createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex")
    .substring(0, 4)
    .toUpperCase();
  return sig === expected;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  var { license_key, text, url } = req.body || {};
  if (!license_key || typeof license_key !== "string") {
    return res.status(400).json({ error: "Missing license_key" });
  }
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing text" });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: "Server not configured: missing GEMINI_API_KEY" });
  }

  var valid = verifyLicense(license_key.trim());
  if (!valid) {
    return res.status(403).json({ error: "Invalid or expired license" });
  }

  var truncated = text.length > 8000 ? text.slice(0, 8000) + "\u2026" : text;
  var prompt = "Summarize the following article in 3-5 sentences. Be concise and capture the key points. Do not use bullet points. Output only the summary:\n\n" + truncated;

  try {
    var resp = await fetch(GEMINI_ENDPOINT + "?key=" + encodeURIComponent(API_KEY), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      var errText = await resp.text();
      console.error("Gemini API error:", resp.status, errText);
      return res.status(502).json({ error: "AI service error" });
    }

    var data = await resp.json();
    var parts = data?.candidates?.[0]?.content?.parts || [];
    var textParts = parts.filter(function(p) { return !p.thought; }).map(function(p) { return p.text; }).filter(Boolean);
    var summary = textParts.length > 0 ? textParts.join(" ").trim() : "";
    if (!summary) {
      return res.status(502).json({ error: "Empty response from AI service" });
    }

    return res.status(200).json({ summary: summary });
  } catch (err) {
    console.error("Summarization failed:", err);
    return res.status(502).json({ error: "AI service unavailable" });
  }
}
