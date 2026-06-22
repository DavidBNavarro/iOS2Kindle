const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const npmJSZip = require("jszip");
const nodemailer = require("nodemailer");
const { query } = require("../lib/turso.js");

async function processInboundEmail(payload) {
  const parsed = parseInboundPayload(payload);

  const userResult = await query("SELECT * FROM users WHERE forwarding_address = ?", [parsed.to]);

  if (userResult.rows.length === 0) {
    return { error: "Unknown forwarding address", status: 404 };
  }

  const user = userResult.rows[0];

  const now = new Date();
  const yearMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const usageResult = await query(
    "SELECT count FROM usage WHERE user_id = ? AND year_month = ? AND source_type = 'newsletter'",
    [user.id, yearMonth]
  );

  const currentUsage = usageResult.rows.length > 0 ? parseInt(usageResult.rows[0].count) : 0;
  const monthlyLimit = 20;

  if (currentUsage >= monthlyLimit) {
    return { error: "Monthly limit reached", status: 429, user };
  }

  const dom = new JSDOM(parsed.html || parsed.text || "");
  const body = dom.window.document.body;

  let title = parsed.subject || "";
  let author = parsed.from || "";
  let content = "";

  if (body) {
    body.querySelectorAll("img").forEach(img => {
      const w = parseInt(img.getAttribute("width") || "0");
      const h = parseInt(img.getAttribute("height") || "0");
      const src = (img.getAttribute("src") || "").toLowerCase();
      if ((w === 1 && h === 1) || src.includes("track") || src.includes("pixel")) {
        img.parentNode.removeChild(img);
      }
    });

    body.querySelectorAll("style, script").forEach(el => el.parentNode.removeChild(el));
    body.querySelectorAll("*").forEach(el => el.removeAttribute("style"));

    const h1 = body.querySelector("h1");
    if (h1) title = h1.textContent.trim();

    content = body.innerHTML.trim();
  }

  content = sanitizeHtmlForEpub(content);

  const epubResult = generateEpubInline({ title, author, content, url: "" });

  await query(
    `INSERT INTO usage (user_id, year_month, count, source_type)
     VALUES (?, ?, 1, 'newsletter')
     ON CONFLICT(user_id, year_month, source_type)
     DO UPDATE SET count = count + 1`,
    [user.id, yearMonth]
  );

  await query(
    "INSERT INTO send_history (user_id, title, source_type) VALUES (?, ?, 'newsletter')",
    [user.id, title || "Untitled"]
  );

  await sendToKindleInline(epubResult.blob, user.kindle_email, title);

  return { success: true, title, user };
}

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
  const UNWRAP_TAGS = new Set([
    "article", "section", "header", "main", "footer", "aside", "nav",
    "figure", "figcaption", "details", "summary", "bdi", "font", "center"
  ]);

  const REMOVE_TAGS = new Set([
    "input", "button", "label", "select", "textarea", "form",
    "fieldset", "legend", "meta", "link", "style", "script", "noscript",
    "iframe", "canvas", "audio", "video", "source", "track", "svg", "math"
  ]);

  const dom = new JSDOM(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  const doc = dom.window.document;
  const body = doc.body;

  for (const tag of UNWRAP_TAGS) {
    const els = body.querySelectorAll(tag);
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
      el.parentNode.removeChild(el);
    }
  }

  for (const tag of REMOVE_TAGS) {
    body.querySelectorAll(tag).forEach(el => el.parentNode.removeChild(el));
  }

  const all = body.querySelectorAll("*");
  all.forEach(el => {
    const attrs = [...el.attributes];
    attrs.forEach(attr => {
      if (/^(aria-|on|data-|role|tabindex|playsinline|typeof|property|resource|prefix|vocab|about|datatype|inlist|contenteditable|spellcheck|hidden|draggable|translate|loading|sizes|srcset|frameborder|scrolling|class|style|align|valign|bgcolor|border|cellpadding|cellspacing|colspan|rowspan|nowrap|width|height)$/i.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    });
    el.removeAttribute("id");
  });

  body.querySelectorAll("picture").forEach(pic => {
    const img = pic.querySelector("img");
    if (img) pic.parentNode.insertBefore(img, pic);
    pic.parentNode.removeChild(pic);
  });

  body.querySelectorAll("li").forEach(li => {
    const parent = li.parentNode;
    if (!parent || (parent.nodeName !== "UL" && parent.nodeName !== "OL")) {
      li.parentNode.removeChild(li);
    }
  });

  body.querySelectorAll("ul, ol").forEach(list => {
    if (!list.querySelector("li")) list.parentNode.removeChild(list);
  });

  return body.innerHTML;
}

function generateEpubInline(opts) {
  const ROOT = path.join(process.cwd());

  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Element = dom.window.Element;
  globalThis.DOMTokenList = dom.window.DOMTokenList;
  globalThis.Set = Set;

  globalThis.JSZip = npmJSZip;

  globalThis.Blob = class Blob {
    constructor(parts, opts) {
      this._parts = parts || [];
      this.type = (opts && opts.type) || "";
    }
    get size() { return Buffer.concat(this._parts.map(p => typeof p === "string" ? Buffer.from(p, "utf-8") : Buffer.isBuffer(p) ? p : Buffer.from(String(p)))).length; }
    async arrayBuffer() { return this._buff().buffer; }
    _buff() { return Buffer.concat(this._parts.map(p => typeof p === "string" ? Buffer.from(p, "utf-8") : Buffer.isBuffer(p) ? p : Buffer.from(String(p)))); }
  };

  const globEval = eval;
  globEval(fs.readFileSync(path.join(ROOT, "extension", "lib", "readability.js"), "utf8"));
  globEval(fs.readFileSync(path.join(ROOT, "extension", "epub-generator.js"), "utf8"));

  const blob = generateEpub({
    article: { title: opts.title || "Untitled", author: opts.author || "", content: opts.content || "" },
    originalHtml: opts.content || "",
    url: opts.url || "",
    title: opts.title || "Untitled",
    keepLinks: true,
    keepImages: false
  });

  return { blob };
}

async function sendToKindleInline(blob, kindleEmail, title) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || "noreply@web2reader.com";

  if (!host || !user || !pass) {
    throw new Error("SMTP configuration missing");
  }

  const epubBuffer = Buffer.from(await blob.arrayBuffer());
  const filename = (title || "article").replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50) + ".epub";

  const boundary = "----KindleBoundary_" + Math.random().toString(36).substring(2);
  const encodedSubject = Buffer.from("convert", "utf-8").toString("base64");

  const lines = [];
  lines.push("From: " + from + "\r\n");
  lines.push("To: " + kindleEmail + "\r\n");
  lines.push("Subject: =?UTF-8?B?" + encodedSubject + "?=\r\n");
  lines.push("MIME-Version: 1.0\r\n");
  lines.push("Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n");
  lines.push("\r\n");
  lines.push("--" + boundary + "\r\n");
  lines.push("Content-Type: application/epub+zip; name=\"" + filename + "\"\r\n");
  lines.push("Content-Transfer-Encoding: base64\r\n");
  lines.push("Content-Disposition: attachment; filename=\"" + filename + "\"\r\n");
  lines.push("\r\n");

  const encoded = epubBuffer.toString("base64");
  for (let i = 0; i < encoded.length; i += 76) {
    lines.push(encoded.substring(i, i + 76) + "\r\n");
  }

  lines.push("\r\n");
  lines.push("--" + boundary + "--\r\n");

  const rawMessage = lines.join("");

  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    envelope: { from, to: kindleEmail },
    raw: rawMessage
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const webhookSecret = process.env.SENDGRID_INBOUND_SECRET;
  if (webhookSecret) {
    const auth = req.headers["x-webhook-token"];
    if (auth !== webhookSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const result = await processInboundEmail(req.body);
    if (result.error) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    return res.status(200).json({ success: true, title: result.title });
  } catch (e) {
    return res.status(500).json({ error: "Processing failed: " + e.message });
  }
};
