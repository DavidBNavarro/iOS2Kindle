import net from "net";
import tls from "tls";

export default async function handler(req, res) {
  var results = [];

  var socket = net.createConnection(parseInt(process.env.SMTP_PORT || "587"), process.env.SMTP_HOST);

  await new Promise(function(resolve, reject) {
    var done = false;
    socket.on("connect", function() { if (!done) { done = true; resolve(); } });
    socket.on("error", function(e) { if (!done) { done = true; reject("Socket error: " + e.message); } });
    setTimeout(function() { if (!done) { done = true; reject("Connect timeout"); } }, 10000);
  });
  results.push("Connected");

  function readResp(s, label, timeout) {
    var buf = "", onData, timer;
    return new Promise(function(resolve, reject) {
      timer = setTimeout(function() { s.removeListener("data", onData); reject("Timeout [" + label + "] buf='" + buf.slice(-100) + "'"); }, timeout || 10000);
      onData = function(chunk) {
        buf += chunk.toString();
        var idx = buf.indexOf("\r\n");
        if (idx >= 0) {
          clearTimeout(timer);
          s.removeListener("data", onData);
          resolve(buf.substring(0, idx));
        }
      };
      s.on("data", onData);
    });
  }

  var greet = await readResp(socket, "greeting");
  results.push("Greeting: " + greet);

  socket.write("EHLO web2reader.com\r\n");
  var ehlo = await readResp(socket, "ehlo");
  results.push("EHLO lines: " + ehlo.split("\r\n").length);

  socket.write("STARTTLS\r\n");
  var stls = await readResp(socket, "starttls");
  results.push("STARTTLS: " + stls);

  // TLS upgrade - add data listener BEFORE connect completes
  var tlsSocket = tls.connect({ socket: socket, rejectUnauthorized: false });
  var tlsRead = readResp(tlsSocket, "tls-greeting", 15000);
  await new Promise(function(resolve, reject) {
    var done = false;
    tlsSocket.on("connect", function() { if (!done) { done = true; resolve(); } });
    tlsSocket.on("error", function(e) { if (!done) { done = true; reject("TLS error: " + e.message); } });
    setTimeout(function() { if (!done) { done = true; reject("TLS connect timeout"); } }, 10000);
  });
  var tlsGreet = await tlsRead;
  results.push("TLS greeting: " + tlsGreet);

  tlsSocket.write("EHLO web2reader.com\r\n");
  var ehlo2 = await readResp(tlsSocket, "ehlo2");
  results.push("EHLO2 lines: " + ehlo2.split("\r\n").length);

  tlsSocket.end();
  res.json({ results: results });
}
