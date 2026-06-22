import net from "net";
import tls from "tls";

function b64(s) { return Buffer.from(s).toString("base64"); }

function smtpReader(socket, timeout) {
  var buf = "";
  var onData, timer;
  var p = new Promise(function(resolve, reject) {
    timer = setTimeout(function() {
      socket.removeListener("data", onData);
      reject(new Error("SMTP timeout\nPartial: " + buf.slice(-200)));
    }, timeout || 20000);
    onData = function(chunk) {
      buf += chunk.toString();
      // SMTP response ends with "code SPACE text\r\n" on the final line
      var lines = buf.split("\r\n");
      if (lines.length >= 2) {
        var last = lines[lines.length - 2]; // last complete line (before trailing \r\n)
        if (/^\d{3} /.test(last)) {
          clearTimeout(timer);
          socket.removeListener("data", onData);
          var code = parseInt(last.slice(0, 3), 10);
          resolve({ code: code, text: buf.trim() });
        }
      }
    };
    socket.on("data", onData);
  });
  return p;
}

async function smtpSend(socket, cmd, expCode) {
  return new Promise(function(resolve, reject) {
    socket.write(cmd + "\r\n", function(err) {
      if (err) return reject(err);
      resolve();
    });
  }).then(function() { return smtpReader(socket); }).then(function(r) {
    if (r.code !== expCode) throw new Error("SMTP " + cmd.split(" ")[0] + " failed (" + r.code + "): " + r.text);
    return r;
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

  var socket = net.createConnection(port, host);
  var reader = smtpReader(socket, 20000);

  function cmd(c, exp) { return smtpSend(socket, c, exp); }

  try {
    // 1. Greeting
    var greet = await reader;
    if (greet.code !== 220) throw new Error("SMTP connect failed: " + greet.text);

    // 2. EHLO
    await cmd("EHLO web2reader.com", 250);

    // 3. STARTTLS (port 587, not 465)
    if (port !== 465) {
      await cmd("STARTTLS", 220);
      var plain = socket;
      // Set up reader BEFORE TLS connect so we don't miss the greeting
      socket = tls.connect({ socket: plain, rejectUnauthorized: false });
      reader = smtpReader(socket, 20000);
      await new Promise(function(resolve, reject) {
        socket.on("connect", resolve);
        socket.on("error", reject);
      });
      var tlsGreet = await reader;
      if (tlsGreet.code !== 220) throw new Error("TLS handshake failed: " + tlsGreet.text);
      reader = smtpReader(socket, 20000);
      await cmd("EHLO web2reader.com", 250);
    }

    // 4. AUTH LOGIN
    await cmd("AUTH LOGIN", 334);
    await cmd(b64(user), 334);
    await cmd(b64(pass), 235);

    // 5. MAIL FROM / RCPT TO
    await cmd("MAIL FROM:<" + from + ">", 250);
    await cmd("RCPT TO:<" + kindleEmail + ">", 250);

    // 6. DATA
    await cmd("DATA", 354);
    await cmd(msg + "\r\n.", 250);

    // 7. QUIT
    await cmd("QUIT", 221);
    socket.end();

    return { messageId: title + "@web2reader.com" };

  } catch (e) {
    socket.end();
    throw e;
  }
}
