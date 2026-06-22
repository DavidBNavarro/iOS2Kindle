import nodemailer from "../lib/nodemailer-bundle.esm.js";

export async function sendToKindle(epubBuffer, kindleEmail, title) {
  var host = process.env.SMTP_HOST;
  var port = parseInt(process.env.SMTP_PORT || "587");
  var user = process.env.SMTP_USER;
  var pass = process.env.SMTP_PASS;
  var from = process.env.SMTP_FROM || "noreply@web2reader.com";

  if (!host || !user || !pass) {
    throw new Error("SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required)");
  }

  var filename = (title || "article").replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50) + ".epub";

  var transporter = nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465,
    auth: { user: user, pass: pass }
  });

  var info = await transporter.sendMail({
    from: from,
    to: kindleEmail,
    subject: "convert",
    text: "",
    attachments: [{
      filename: filename,
      content: epubBuffer,
      contentType: "application/epub+zip"
    }]
  });

  return info;
}
