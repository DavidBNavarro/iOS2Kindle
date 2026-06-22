import net from "net";
import tls from "tls";

export default async function handler(req, res) {
  var host = process.env.SMTP_HOST;
  var port = parseInt(process.env.SMTP_PORT || "587");
  var user = process.env.SMTP_USER;
  var pass = process.env.SMTP_PASS;

  var results = [];

  // Test 1: DNS resolution
  results.push("Host: " + host + " Port: " + port + " User: " + (user ? user.substring(0, 5) + "..." : "unset") + " Pass: " + (pass ? "set" : "unset"));

  // Test 2: TCP connect
  try {
    var s = net.createConnection(port, host);
    var connected = await new Promise(function(resolve, reject) {
      var done = false;
      s.on("connect", function() { if (!done) { done = true; resolve(true); } });
      s.on("error", function(e) { if (!done) { done = true; resolve("Error: " + e.message); } });
      setTimeout(function() { if (!done) { done = true; resolve("Timeout after 5s"); } }, 5000);
    });
    results.push("TCP connect: " + connected);
    s.end();
  } catch (e) {
    results.push("TCP connect error: " + e.message);
  }

  // Test 3: TLS connect
  try {
    var t = tls.connect(port, host, { rejectUnauthorized: false });
    var tlsOk = await new Promise(function(resolve, reject) {
      var done = false;
      t.on("connect", function() { if (!done) { done = true; resolve(true); } });
      t.on("error", function(e) { if (!done) { done = true; resolve("Error: " + e.message); } });
      setTimeout(function() { if (!done) { done = true; resolve("Timeout after 5s"); } }, 5000);
    });
    results.push("TLS connect: " + tlsOk);
    t.end();
  } catch (e) {
    results.push("TLS connect error: " + e.message);
  }

  res.json({ results: results });
};
