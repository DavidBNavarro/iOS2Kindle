import crypto from "crypto";

var SECRET = process.env.LICENSE_HMAC_SECRET || "dev-secret-change-in-production";

function verifyKey(key) {
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

function generateKey() {
  var parts = [];
  for (var i = 0; i < 2; i++) {
    parts.push(crypto.randomBytes(2).toString("hex").toUpperCase());
  }
  var payload = parts.join("-");
  var sig = crypto.createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex")
    .substring(0, 4)
    .toUpperCase();
  return "WK-" + payload + "-" + sig;
}

function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  var license_key = (req.body || {}).license_key;
  if (!license_key || typeof license_key !== "string") {
    return res.status(400).json({ valid: false, error: "Missing license_key" });
  }
  var valid = verifyKey(license_key.trim());
  return res.status(200).json({ valid: valid });
}

export default handler;
export { generateKey, verifyKey };
