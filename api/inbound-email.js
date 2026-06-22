import { JSDOM } from "jsdom";
import { query } from "../lib/turso.js";

function parseMultipart(body, contentType) {
  var boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundary) return {};
  boundary = (boundary[1] || boundary[2]).trim();

  var parts = body.split("--" + boundary);
  var fields = {};
  var rawBoundary = Buffer.from("--" + boundary, "binary").toString();

  for (var raw of parts) {
    raw = raw.replace(/\r?\n$/, "");
    if (!raw || raw === "--") continue;

    // Split headers from body at first double newline
    var headerEnd = raw.indexOf("\n\n");
    if (headerEnd === -1) headerEnd = raw.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    var headerStr = raw.slice(0, headerEnd).trim();
    var value = raw.slice(headerEnd + 2).trim();

    // Remove trailing boundary markers
    value = value.replace(/^[\r\n]+|[\r\n]+$/g, "").replace(/^--|--$/g, "").trim();

    // Get field name from Content-Disposition header
    var nameMatch = headerStr.match(/name\s*=\s*"([^"]+)"/i);
    if (!nameMatch) continue;
    var name = nameMatch[1];

    fields[name] = value;
  }
  return fields;
}

function sanitizeHtml(html) {
  var UNWRAP_TAGS = new Set([
    "article", "section", "header", "main", "footer", "aside", "nav",
    "figure", "figcaption", "details", "summary", "bdi", "font", "center"
  ]);
  var REMOVE_TAGS = new Set([
    "input", "button", "label", "select", "textarea", "form",
    "fieldset", "legend", "meta", "link", "style", "script", "noscript",
    "iframe", "canvas", "audio", "video", "source", "track", "svg", "math"
  ]);
  var STRIP_ATTR_PAT = /^(aria-|on|data-|role|tabindex|playsinline|typeof|property|resource|prefix|vocab|about|datatype|inlist|contenteditable|spellcheck|hidden|draggable|translate|loading|sizes|srcset|frameborder|scrolling|class|style|align|valign|bgcolor|border|cellpadding|cellspacing|colspan|rowspan|nowrap|width|height)$/i;

  var dom = new JSDOM("<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>" + html + "</body></html>");
  var doc = dom.window.document;
  var body = doc.body;

  for (var tag of UNWRAP_TAGS) {
    var els = body.querySelectorAll(tag);
    for (var i = els.length - 1; i >= 0; i--) {
      var el = els[i];
      while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
      el.parentNode.removeChild(el);
    }
  }
  for (var tag of REMOVE_TAGS) {
    body.querySelectorAll(tag).forEach(function(el) { el.parentNode.removeChild(el); });
  }
  body.querySelectorAll("*").forEach(function(el) {
    var attrs = [...el.attributes];
    for (var attr of attrs) {
      if (STRIP_ATTR_PAT.test(attr.name)) el.removeAttribute(attr.name);
    }
    el.removeAttribute("id");
  });
  body.querySelectorAll("picture").forEach(function(pic) {
    var img = pic.querySelector("img");
    if (img) pic.parentNode.insertBefore(img, pic);
    pic.parentNode.removeChild(pic);
  });
  body.querySelectorAll("img").forEach(function(img) {
    var w = parseInt(img.getAttribute("width") || "0");
    var h = parseInt(img.getAttribute("height") || "0");
    var src = (img.getAttribute("src") || "").toLowerCase();
    if ((w === 1 && h === 1) || src.includes("track") || src.includes("pixel")) {
      img.parentNode.removeChild(img);
    }
  });
  body.querySelectorAll("li").forEach(function(li) {
    var parent = li.parentNode;
    if (!parent || (parent.nodeName !== "UL" && parent.nodeName !== "OL")) {
      li.parentNode.removeChild(li);
    }
  });
  body.querySelectorAll("ul, ol").forEach(function(list) {
    if (!list.querySelector("li")) list.parentNode.removeChild(list);
  });

  return body.innerHTML;
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

    // Extract title from HTML using jsdom
    var title = subject;
    if (html) {
      try {
        var dom = new JSDOM(html);
        var h1 = dom.window.document.querySelector("h1");
        if (h1 && h1.textContent.trim()) {
          title = h1.textContent.trim();
        }
      } catch (e) {
        // Fall back to subject
      }
    }

    // Clean HTML for storage
    var cleanHtml = html ? sanitizeHtml(html) : "";

    // Record usage
    await query(
      "INSERT INTO usage (user_id, year_month, count, source_type)\n     VALUES (?, ?, 1, 'newsletter')\n     ON CONFLICT(user_id, year_month, source_type)\n     DO UPDATE SET count = count + 1",
      [user.id, yearMonth]
    );

    // Record in send history with html content stored
    await query(
      "INSERT INTO send_history (user_id, title, url, source_type, status)\n     VALUES (?, ?, ?, 'newsletter', 'pending')",
      [user.id, title || "Untitled", from]
    );

    return res.status(200).json({
      success: true,
      title: title || "Untitled",
      has_html: !!cleanHtml
    });

  } catch (e) {
    return res.status(500).json({ error: "Processing failed: " + e.message });
  }
};
