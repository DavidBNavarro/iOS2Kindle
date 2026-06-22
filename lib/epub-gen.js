import { parseHTML } from "../lib/linkedom-bundle.esm.js";
import JSZip from "../lib/jszip-bundle.esm.js";

function sanitizeForEpub(html) {
  var dom = parseHTML("<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>" + html + "</body></html>");
  var doc = dom.document;
  var body = doc.body;

  var UNWRAP = new Set(["article","section","header","main","footer","aside","nav","figure","figcaption","details","summary","bdi","font","center"]);
  var REMOVE = new Set(["input","button","label","select","textarea","form","fieldset","legend","meta","link","style","script","noscript","iframe","canvas","audio","video","source","track","svg","math"]);
  var STRIP_ATTR = /^(aria-|on|data-|role|tabindex|playsinline|typeof|property|resource|prefix|vocab|about|datatype|inlist|contenteditable|spellcheck|hidden|draggable|translate|loading|sizes|srcset|frameborder|scrolling|class|style|align|valign|bgcolor|border|cellpadding|cellspacing|colspan|rowspan|nowrap|width|height)$/i;

  for (var tag of UNWRAP) {
    var els = body.querySelectorAll(tag);
    for (var i = els.length - 1; i >= 0; i--) {
      var el = els[i];
      while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
      el.parentNode.removeChild(el);
    }
  }
  for (var tag of REMOVE) {
    body.querySelectorAll(tag).forEach(function(el) { if (el.parentNode) el.parentNode.removeChild(el); });
  }
  body.querySelectorAll("*").forEach(function(el) {
    var attrs = [...el.attributes];
    for (var attr of attrs) {
      if (STRIP_ATTR.test(attr.name)) el.removeAttribute(attr.name);
    }
    el.removeAttribute("id");
  });
  body.querySelectorAll("picture").forEach(function(pic) {
    var img = pic.querySelector("img");
    if (img) pic.parentNode.insertBefore(img, pic);
    pic.parentNode.removeChild(pic);
  });
  body.querySelectorAll("img").forEach(function(img) {
    var w = parseInt(img.getAttribute("width") || "0");
    var h = parseInt(img.getAttribute("height") || "0");
    var src = (img.getAttribute("src") || "").toLowerCase();
    if ((w === 1 && h === 1) || src.includes("track") || src.includes("pixel")) {
      if (img.parentNode) img.parentNode.removeChild(img);
    }
  });
  body.querySelectorAll("li").forEach(function(li) {
    var p = li.parentNode;
    if (!p || (p.nodeName !== "UL" && p.nodeName !== "OL")) {
      if (li.parentNode) li.parentNode.removeChild(li);
    }
  });
  body.querySelectorAll("ul, ol").forEach(function(list) {
    if (!list.querySelector("li")) list.parentNode.removeChild(list);
  });

  return body.innerHTML;
}

function stripUnicodeControls(text) {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\u00ad\ud800-\udbff\udc00-\udfff]/g, "")
    .replace(/[\u{1F3FB}-\u{1F3FF}\u{1F9B0}-\u{1F9B3}]/gu, "")
    .replace(/\s+/g, " ").trim();
}

function makeFilename(title) {
  return title.replace(/[^a-zA-Z0-9\s-]/g, "").trim().substring(0, 50).replace(/\s+/g, "_") || "article";
}

function sanitizeKindleText(text) {
  return (text || "").replace(/[\u200d\u20e3\u2300-\u27bf\u2934-\u2935\u2b00-\u2bff\u3030\u303d\u3297\u3299\ufe0e-\ufe0f]/g, "")
    .replace(/[\ud800-\udbff\udc00-\udfff]/g, "")
    .replace(/\s+/g, " ").trim();
}

function generateId() {
  return "id-" + Math.random().toString(36).substring(2, 10);
}

export function generateEpub(opts) {
  var title = sanitizeKindleText(opts.title || "Article");
  var author = sanitizeKindleText(opts.author || "");
  var contentHtml = opts.content || "";
  var url = opts.url || "";

  var cleanContent = sanitizeForEpub(contentHtml);
  var filename = makeFilename(title);
  var uid = generateId();
  var now = new Date();
  var dateStr = now.toISOString().split("T")[0];
  var dateTimeStr = now.toISOString().replace(/\.\d{3}/, "");

  var contentXhtml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"en\" lang=\"en\">\n<head>\n<meta charset=\"utf-8\"/>\n<title>" + title.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"style/default.css\"/>\n</head>\n<body>\n<div id=\"content\">\n" + cleanContent + "\n</div>\n</body>\n</html>";

  var opf = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"2.0\" unique-identifier=\"BookId\">\n<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:opf=\"http://www.idpf.org/2007/opf\">\n<dc:identifier id=\"BookId\">urn:uuid:" + uid + "</dc:identifier>\n<dc:title>" + title.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</dc:title>\n<dc:language>en</dc:language>\n<dc:date>" + dateStr + "</dc:date>\n<meta content=\"" + dateTimeStr + "\" name=\"dcterms:modified\"/>\n" + (author ? "<dc:creator>" + author.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</dc:creator>\n" : "") + "</metadata>\n<manifest>\n<item id=\"content\" href=\"content.xhtml\" media-type=\"application/xhtml+xml\"/>\n<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n<item id=\"css\" href=\"style/default.css\" media-type=\"text/css\"/>\n</manifest>\n<spine toc=\"ncx\">\n<itemref idref=\"content\"/>\n</spine>\n<guide>\n<reference type=\"text\" title=\"" + title.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + "\" href=\"content.xhtml\"/>\n</guide>\n</package>";

  var ncx = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!DOCTYPE ncx PUBLIC \"-//NISO//DTD ncx 2005-1//EN\" \"http://www.daisy.org/z3986/2005/ncx-2005-1.dtd\">\n<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\" xml:lang=\"en\">\n<head>\n<meta name=\"dtb:uid\" content=\"urn:uuid:" + uid + "\"/>\n<meta name=\"dtb:depth\" content=\"1\"/>\n</head>\n<docTitle><text>" + title.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</text></docTitle>\n" + (author ? "<docAuthor><text>" + author.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</text></docAuthor>\n" : "") + "<navMap>\n<navPoint id=\"navpoint-1\" playOrder=\"1\">\n<navLabel><text>" + title.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</text></navLabel>\n<content src=\"content.xhtml\"/>\n</navPoint>\n</navMap>\n</ncx>";

  var css = "body { font-family: Georgia, serif; line-height: 1.6; padding: 1em; }\nh1, h2, h3, h4 { font-family: Arial, sans-serif; }\np { margin: 0.5em 0; }\na { color: #000; text-decoration: none; }\nimg { max-width: 100%; height: auto; }\nul, ol { margin: 0.5em 0; padding-left: 2em; }\nblockquote { margin: 0.5em 1em; padding: 0.5em 1em; border-left: 3px solid #ccc; color: #555; }\npre { font-family: monospace; white-space: pre-wrap; background: #f5f5f5; padding: 0.5em; }\ntable { border-collapse: collapse; width: 100%; }\ntd, th { border: 1px solid #ccc; padding: 0.3em; }\n";

  var zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.folder("META-INF").file("container.xml", "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<container xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\" version=\"1.0\">\n<rootfiles>\n<rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\n</rootfiles>\n</container>");
  zip.folder("OEBPS").file("content.xhtml", contentXhtml);
  zip.folder("OEBPS").file("content.opf", opf);
  zip.folder("OEBPS").file("toc.ncx", ncx);
  zip.folder("OEBPS/style").file("default.css", css);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", mimeType: "application/epub+zip" });
}
