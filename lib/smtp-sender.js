const nodemailer = require("nodemailer");

function buildKindleMessage({ from, to, epubBuffer, filename }) {
  const boundary = "----KindleBoundary_" + Math.random().toString(36).substring(2);
  const encodedSubject = Buffer.from("convert", "utf-8").toString("base64");

  const lines = [];
  lines.push("From: " + from + "\r\n");
  lines.push("To: " + to + "\r\n");
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

  return lines.join("");
}

async function sendEpubToKindle(epubBuffer, kindleEmail, filename) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || "noreply@web2kindle.com";

  if (!host || !user || !pass) {
    throw new Error("SMTP configuration missing (SMTP_HOST, SMTP_USER, SMTP_PASS)");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  const message = buildKindleMessage({
    from,
    to: kindleEmail,
    epubBuffer,
    filename: filename || "article.epub"
  });

  await transporter.sendMail({
    envelope: { from, to: kindleEmail },
    raw: message
  });
}

module.exports = { buildKindleMessage, sendEpubToKindle };
