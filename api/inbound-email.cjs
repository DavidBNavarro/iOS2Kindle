var jsdom = require("jsdom");
var crypto = require("crypto");

module.exports = async function handler(req, res) {
  try {
    var dom = new jsdom.JSDOM("<!DOCTYPE html><html><body><h1>test</h1></body></html>");
    var title = dom.window.document.querySelector("h1").textContent;
    res.status(200).json({ ok: true, title: title, id: crypto.randomUUID() });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
};
