import net from "net";
import tls from "tls";

function b64(s) { return Buffer.from(s).toString("base64"); }

export async function sendToKindle(epubBuffer, kindleEmail, title) {
  var host = process.env.SMTP_HOST;
  var port = parseInt(process.env.SMTP_PORT || "465");
  var user = process.env.SMTP_USER;
  var pass = process.env.SMTP_PASS;
  var from = process.env.SMTP_FROM || "noreply@web2reader.com";

  if (!host || !user || !pass)
    throw new Error("SMTP not configured");

  var filename = (title || "article").replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50) + ".epub";

  var boundary = "===" + Math.random().toString(36).substring(2) + "===";
  var msg = "From: " + from + "\r\nTo: " + kindleEmail + "\r\nSubject: convert\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n\r\n--" + boundary + "\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n\r\n--" + boundary + "\r\nContent-Type: application/epub+zip; name=\"" + filename + "\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"" + filename + "\"\r\n\r\n";
  var b = epubBuffer.toString("base64");
  for (var i = 0; i < b.length; i += 76) msg += b.substring(i, i + 76) + "\r\n";
  msg += "\r\n--" + boundary + "--\r\n";

  // Direct TLS connection on port 465
  var socket = tls.connect(port, host, { rejectUnauthorized: false, servername: host });

  // Wait for connect + read greeting
  var greeting = await readResponse(socket, 15000);
  if (greeting.code !== 220) throw new Error("SMTP connect failed (" + greeting.code + "): " + greeting.text);

  await cmd(socket, "EHLO web2reader.com", 250);
  await cmd(socket, "AUTH LOGIN", 334);
  await cmd(socket, b64(user), 334);
  await cmd(socket, b64(pass), 235);
  await cmd(socket, "MAIL FROM:<" + from + ">", 250);
  await cmd(socket, "RCPT TO:<" + kindleEmail + ">", 250);
  await cmd(socket, "DATA", 354);
  await cmd(socket, msg + "\r\n.", 250);
  await cmd(socket, "QUIT", 221);
  socket.end();

  return { messageId: title + "@web2reader.com" };
}

function readResponse(s, timeout) {
  var buf = "", onData, timer;
  return new Promise(function(resolve, reject) {
    timer = setTimeout(function() {
      s.removeListener("data", onData);
      reject(new Error("SMTP timeout\nPartial: " + buf.slice(-200)));
    }, timeout || 20000);
    onData = function(chunk) {
      buf += chunk.toString();
      var lines = buf.split("\r\n").filter(Boolean);
      if (lines.length > 0) {
        var last = lines[lines.length - 1];
        if (/^\d{3} /.test(last)) {
          clearTimeout(timer);
          s.removeListener("data", onData);
          var code = parseInt(last.slice(0, 3), 10);
          resolve({ code: code, text: buf.trim() });
        }
      }
    };
    s.on("data", onData);
  });
}

function cmd(socket, text, expCode) {
  return new Promise(function(resolve, reject) {
    socket.write(text + "\r\n", function(err) {
      if (err) return reject(err);
      resolve();
    });
  }).then(function() { return readResponse(socket, 15000); }).then(function(r) {
    if (r.code !== expCode) throw new Error("SMTP " + text.split(" ")[0] + " failed (" + r.code + "): " + r.text);
    return r;
  });
}
