import { parseHTML } from "../lib/linkedom-bundle.esm.js";
import { query } from "../lib/turso.js";
import { generateEpub } from "../lib/epub-gen.js";
import { sendToKindle } from "../lib/smtp-send.js";

function parseMultipart(body, contentType) {
  var m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) return {};
  var boundary = (m[1] || m[2]).trim();

  var parts = body.split("--" + boundary);
  var fields = {};

  for (var raw of parts) {
    raw = raw.replace(/\r?\n$/, "");
    if (!raw || raw === "--") continue;

    var headerEnd = raw.indexOf("\n\n");
    if (headerEnd === -1) headerEnd = raw.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    var value = raw.slice(headerEnd + 2).trim()
      .replace(/^[\r\n]+|[\r\n]+$/g, "").replace(/^--|--$/g, "").trim();

    var nameMatch = raw.slice(0, headerEnd).match(/name\s*=\s*"([^"]+)"/i);
    if (!nameMatch) continue;
    fields[nameMatch[1]] = value;
  }
  return fields;
}

function extractTitle(html, fallback) {
  if (!html) return fallback;
  try {
    var dom = parseHTML(html);
    var h1 = dom.document.querySelector("h1");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
  } catch (e) {}
  return fallback;
}

function stripUnicodeControls(text) {
  return String(text || "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\u00ad\ud800-\udbff\udc00-\udfff]/g, "").replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    var contentType = req.headers["content-type"] || "";
    var isMultipart = contentType.includes("multipart/form-data");
    var payload;

    if (isMultipart) {
      var rawBody = req.body;
      if (typeof rawBody === "string") {
        payload = parseMultipart(rawBody, contentType);
      } else if (Buffer.isBuffer(rawBody)) {
        payload = parseMultipart(rawBody.toString("binary"), contentType);
      } else {
        payload = req.body || {};
      }
    } else {
      payload = req.body || {};
    }

    var from = payload.from || "";
    var to = (payload.to || "").trim();
    var subject = payload.subject || "";
    var html = payload.html || payload.text || "";
    var title = extractTitle(html, subject);

    var userResult = await query(
      "SELECT * FROM users WHERE forwarding_address = ?",
      [to]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "Unknown forwarding address: " + to });
    }

    var user = userResult.rows[0];

    // Check usage limit
    var now = new Date();
    var yearMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    var usageResult = await query(
      "SELECT count FROM usage WHERE user_id = ? AND year_month = ? AND source_type = 'newsletter'",
      [user.id, yearMonth]
    );

    var currentUsage = usageResult.rows.length > 0 ? parseInt(usageResult.rows[0].count) : 0;
    if (currentUsage >= 20) {
      return res.status(429).json({ error: "Monthly limit reached" });
    }

    // Generate EPUB and send to Kindle
    var epubBuffer = null;
    var sendError = null;
    var status = "pending";

    try {
      epubBuffer = await generateEpub({
        title: stripUnicodeControls(title || "Article"),
        author: stripUnicodeControls(from),
        content: html || ""
      });

      await sendToKindle(epubBuffer, user.kindle_email, title);
      status = "sent";
    } catch (e) {
      sendError = e.message;
      status = "failed";
    }

    // Record usage
    await query(
      "INSERT INTO usage (user_id, year_month, count, source_type)\n     VALUES (?, ?, 1, 'newsletter')\n     ON CONFLICT(user_id, year_month, source_type)\n     DO UPDATE SET count = count + 1",
      [user.id, yearMonth]
    );

    // Record history
    await query(
      "INSERT INTO send_history (user_id, title, url, source_type, status)\n     VALUES (?, ?, ?, 'newsletter', ?)",
      [user.id, title || "Untitled", from, status]
    );

    var response = { success: status === "sent", title: title || "Untitled", status: status };
    if (sendError) response.error = sendError;

    return res.status(status === "sent" ? 200 : 202).json(response);

  } catch (e) {
    return res.status(500).json({ error: "Processing failed: " + e.message });
  }
};
