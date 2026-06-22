const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

let _loaded = false;

function loadExtensionSources() {
  if (_loaded) return;
  _loaded = true;

  const readabilityPath = path.join(ROOT, "extension", "lib", "readability.js");
  const epubGenPath = path.join(ROOT, "extension", "epub-generator.js");

  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Element = dom.window.Element;
  globalThis.DOMTokenList = dom.window.DOMTokenList;
  globalThis.Set = Set;
  globalThis.JSZip = require("jszip");

  if (!globalThis.Blob) {
    globalThis.Blob = class Blob {
      constructor(parts, opts) {
        this._parts = parts || [];
        this.type = (opts && opts.type) || "";
      }
      get size() {
        return Buffer.concat(this._parts.map(p => {
          if (typeof p === "string") return Buffer.from(p, "utf-8");
          if (Buffer.isBuffer(p)) return p;
          if (p instanceof Uint8Array) return Buffer.from(p);
          return Buffer.from(String(p));
        })).length;
      }
      async arrayBuffer() {
        const buf = Buffer.concat(this._parts.map(p => {
          if (typeof p === "string") return Buffer.from(p, "utf-8");
          if (Buffer.isBuffer(p)) return p;
          if (p instanceof Uint8Array) return Buffer.from(p);
          return Buffer.from(String(p));
        }));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
    };
  }

  const globEval = eval;
  globEval(fs.readFileSync(readabilityPath, "utf8"));
  globEval(fs.readFileSync(epubGenPath, "utf8"));
}

const { sanitizeHtmlForEpub } = require("./sanitize-epub.cjs");

async function generateEpubNode(opts) {
  loadExtensionSources();

  const { title, author, content, url } = opts;
  const sanitizedContent = sanitizeHtmlForEpub(content || "");

  const article = {
    title: title || "Untitled",
    author: author || "",
    content: sanitizedContent
  };

  const blob = await generateEpub({
    article,
    originalHtml: content || "",
    url: url || "",
    title: title || "Untitled",
    keepLinks: true,
    keepImages: false
  });

  return { blob, article };
}

module.exports = { generateEpubNode };
