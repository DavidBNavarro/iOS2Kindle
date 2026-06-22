import { parseHTML } from "linkedom";
import { query } from "../lib/turso.js";

function parseInboundPayload(payload) {
  return {
    from: payload.from || "",
    to: (payload.to || "").trim(),
    subject: payload.subject || "",
    html: payload.html || "",
    text: payload.text || ""
  };
}

function sanitizeHtmlForEpub(html) {
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

  var dom = parseHTML("<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>" + html + "</body></html>");
  var doc = dom.document;
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
    attrs.forEach(function(attr) {
      if (STRIP_ATTR_PAT.test(attr.name)) el.removeAttribute(attr.name);
    });
    el.removeAttribute("id");
  });
  body.querySelectorAll("picture").forEach(function(pic) {
    var img = pic.querySelector("img");
    if (img) pic.parentNode.insertBefore(img, pic);
    pic.parentNode.removeChild(pic);
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

async function processInboundEmail(payload) {
  var parsed = parseInboundPayload(payload);

  var userResult = await query(
    "SELECT * FROM users WHERE forwarding_address = ?",
    [parsed.to]
  );

  if (userResult.rows.length === 0) {
    return { status: 404, error: "Unknown forwarding address: " + parsed.to };
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
    return { status: 429, error: "Monthly limit reached", user: user };
  }

  var dom = parseHTML(parsed.html || parsed.text || "");
  var body = dom.document.body;

  var title = parsed.subject || "";

  if (body) {
    body.querySelectorAll("img").forEach(function(img) {
      var w = parseInt(img.getAttribute("width") || "0");
      var h = parseInt(img.getAttribute("height") || "0");
      var src = (img.getAttribute("src") || "").toLowerCase();
      if ((w === 1 && h === 1) || src.includes("track") || src.includes("pixel")) {
        img.parentNode.removeChild(img);
      }
    });
    body.querySelectorAll("style, script").forEach(function(el) { el.parentNode.removeChild(el); });
    body.querySelectorAll("*").forEach(function(el) { el.removeAttribute("style"); });

    var h1 = body.querySelector("h1");
    if (h1) title = h1.textContent.trim();

  }

  await query(
    "INSERT INTO usage (user_id, year_month, count, source_type)\n     VALUES (?, ?, 1, 'newsletter')\n     ON CONFLICT(user_id, year_month, source_type)\n     DO UPDATE SET count = count + 1",
    [user.id, yearMonth]
  );

  await query(
    "INSERT INTO send_history (user_id, title, source_type) VALUES (?, ?, 'newsletter')",
    [user.id, title || "Untitled"]
  );

  return { success: true, title: title, user: user };
}

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
    var result = await processInboundEmail(req.body);
    if (result.error) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    return res.status(200).json({ success: true, title: result.title });
  } catch (e) {
    return res.status(500).json({ error: "Processing failed: " + e.message });
  }
};
