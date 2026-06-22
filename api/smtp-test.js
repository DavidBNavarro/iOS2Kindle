import net from "net";
import tls from "tls";

export default async function handler(req, res) {
  try {
    var results = [];

    // Test with port 465 (direct TLS)
    var host = process.env.SMTP_HOST;
    var port = 465;

    var socket = tls.connect(port, host, { rejectUnauthorized: false });

    await new Promise(function(resolve, reject) {
      var done = false;
      socket.on("connect", function() { if (!done) { done = true; resolve(); } });
      socket.on("error", function(e) { if (!done) { done = true; reject("TLS error: " + e.message); } });
      setTimeout(function() { if (!done) { done = true; reject("TLS connect timeout"); } }, 15000);
    });
    results.push("TLS connected");

    function readResp(s, timeout) {
      var buf = "", onData, timer;
      return new Promise(function(resolve, reject) {
        timer = setTimeout(function() { s.removeListener("data", onData); reject("Timeout buf='" + buf.slice(-200) + "'"); }, timeout || 10000);
        onData = function(chunk) {
          buf += chunk.toString();
          var lines = buf.split("\r\n").filter(Boolean);
          if (lines.length > 0) {
            var last = lines[lines.length - 1];
            if (/^\d{3} /.test(last)) {
              clearTimeout(timer);
              s.removeListener("data", onData);
              resolve(buf.trim());
            }
          }
        };
        s.on("data", onData);
      });
    }

    var greet = await readResp(socket);
    results.push("Greeting: " + greet);

    socket.write("EHLO web2reader.com\r\n");
    var ehlo = await readResp(socket);
    results.push("EHLO: " + ehlo.split("\n").length + " lines");

    // AUTH LOGIN
    var user = process.env.SMTP_USER;
    var pass = process.env.SMTP_PASS;
    var b64 = function(s) { return Buffer.from(s).toString("base64"); };

    socket.write("AUTH LOGIN\r\n");
    var a1 = await readResp(socket);
    results.push("AUTH: " + a1);

    socket.write(b64(user) + "\r\n");
    var a2 = await readResp(socket);
    results.push("USER: " + a2);

    socket.write(b64(pass) + "\r\n");
    var a3 = await readResp(socket);
    results.push("PASS: " + a3);

    socket.end();
    res.json({ results: results });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
