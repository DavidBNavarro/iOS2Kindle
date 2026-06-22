import nodemailer from "nodemailer";

export default async function handler(req, res) {
  try {
    var t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    var ok = await t.verify();
    res.json({ ok: true, message: "Nodemailer SMTP connection verified" });
  } catch (e) {
    res.json({ ok: false, error: e.message, stack: e.stack?.split("\n").slice(0, 5).join("\n") });
  }
}
