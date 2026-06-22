import net from "net";
import tls from "tls";

function b64(s) { return Buffer.from(s).toString("base64"); }

function readResponse(socket, timeout) {
  return new Promise(function(resolve, reject) {
    var buf = "";
    var timer = setTimeout(function() { reject(new Error("SMTP timeout")); }, timeout || 15000);
    function onData(chunk) {
      buf += chunk.toString();
      // Full response ends with "code SPACE text\r\n"
      if (/^\d{3} .+/m.test(buf.slice(-5))) {
        clearTimeout(timer);
        socket.removeListener("data", onData);
        var code = parseInt(buf.slice(0, 3), 10);
        resolve({ code: code, text: buf.trim() });
      }
    }
    socket.on("data", onData);
  });
}

function writeCmd(socket, cmd) {
  return new Promise(function(resolve, reject) {
    socket.write(cmd + "\r\n", function(err) { if (err) reject(err); else resolve(); });
  });
}

export async function sendToKindle(epubBuffer, kindleEmail, title) {
  var host = process.env.SMTP_HOST;
  var port = parseInt(process.env.SMTP_PORT || "587");
  var user = process.env.SMTP_USER;
  var pass = process.env.SMTP_PASS;
  var from = process.env.SMTP_FROM || "noreply@web2reader.com";

  if (!host || !user || !pass)
    throw new Error("SMTP not configured");

  var filename = (title || "article").replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50) + ".epub";

  var boundary = "===" + Math.random().toString(36).substring(2) + "===";
  var msg = "From: " + from + "\r\nTo: " + kindleEmail + "\r\nSubject: convert\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n\r\n--" + boundary + "\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n\r\n--" + boundary + "\r\nContent-Type: application/epub+zip; name=\"" + filename + "\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"" + filename + "\"\r\n\r\n";
  var b64 = epubBuffer.toString("base64");
  for (var i = 0; i < b64.length; i += 76) msg += b64.substring(i, i + 76) + "\r\n";
  msg += "\r\n--" + boundary + "--\r\n";

  var raw = net.createConnection(port, host);

  function send(cmd, expCode) {
    return writeCmd(raw, cmd).then(function() { return readResponse(raw); }).then(function(r) {
      if (r.code !== expCode) throw new Error("SMTP " + cmd.split(" ")[0] + " failed (" + r.code + "): " + r.text);
      return r;
    });
  }

  try {
    // 1. Greeting
    await readResponse(raw).then(function(r) { if (r.code !== 220) throw new Error("SMTP connect failed: " + r.text); });

    // 2. EHLO
    await send("EHLO web2reader.com", 250);

    // 3. STARTTLS if needed (port 587, not 465)
    if (port !== 465) {
      await send("STARTTLS", 220);
      var plain = raw;
      raw = tls.connect({ socket: plain, rejectUnauthorized: false });
      await new Promise(function(resolve, reject) {
        raw.on("connect", resolve);
        raw.on("error", reject);
      });
      await readResponse(raw).then(function(r) { if (r.code !== 220) throw new Error("TLS handshake failed: " + r.text); });
      await send("EHLO web2reader.com", 250);
    }

    // 4. AUTH LOGIN
    await send("AUTH LOGIN", 334);
    await send(b64(user), 334);
    await send(b64(pass), 235);

    // 5. MAIL FROM / RCPT TO
    await send("MAIL FROM:<" + from + ">", 250);
    await send("RCPT TO:<" + kindleEmail + ">", 250);

    // 6. DATA
    await send("DATA", 354);
    await send(msg + "\r\n.", 250);

    // 7. QUIT
    await send("QUIT", 221);
    raw.end();

    return { messageId: title + "@web2reader.com" };

  } catch (e) {
    raw.end();
    throw e;
  }
}
