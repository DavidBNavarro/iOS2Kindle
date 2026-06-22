export default async function handler(req, res) {
  try {
    var key = process.env.SENDGRID_API_KEY;
    var r = await fetch("https://api.sendgrid.com/v3/senders", {
      headers: { Authorization: "Bearer " + key }
    });
    var data = await r.json();
    var from = process.env.SMTP_FROM;
    var verified = process.env.SENDGRID_VERIFIED_SENDER;
    res.json({
      smtp_from: from,
      verified_sender: verified,
      sendgrid_senders: data
    });
  } catch (e) {
    res.json({ error: e.message });
  }
}
