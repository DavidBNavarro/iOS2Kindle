// Test ios2kindle.js flow: processing in WebView, JSZip in main context
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const npmJSZip = require("jszip");
const ROOT = path.join(__dirname, "..");

async function main() {
  const bundlePath = path.join(ROOT, "ios", "bundle.js");
  const bCode = fs.readFileSync(bundlePath, "utf8");

  const dom = new JSDOM(`<!DOCTYPE html>
<html><head><title>Test Article</title></head>
<body><article>
  <h1>Test Article Title</h1>
  <p>First paragraph with content.</p>
  <p>Second with <a href="https://x.com">linked</a> text.</p>
  <h2>Section One</h2>
  <p>Section one content.</p>
  <h3>Subsection A</h3>
  <p>Subsection content here.</p>
  <h2>Section Two</h2>
  <p>Final section.</p>
</article></body></html>`);
  const doc = dom.window.document;

  // Simulate WebView: DOMParser/XMLSerializer available
  const wvGlobal = {
    document: doc,
    Node: dom.window.Node,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Element: dom.window.Element,
    DOMTokenList: dom.window.DOMTokenList,
    Set: Set,
  };
  Object.assign(globalThis, wvGlobal);
  eval(bCode);

  // --- WebView processing (DOMParser available) ---
  var wvReader = new Readability(doc);
  var wvArticle = wvReader.parse();
  if (!wvArticle || !wvArticle.content) {
    wvArticle = _extractDomArticle(dom.serialize());
  }
  if (!wvArticle) throw new Error("No article");

  var c = _restoreHeadings(wvArticle.content || "");
  c = _supplementContent(c, dom.serialize());
  c = stripUiText(c);
  c = stripTrailingRelated(c);
  c = _sanitizeHtmlForEpub(c);
  c = c.replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1");

  var wvDoc = new DOMParser().parseFromString(c, "text/html");
  var emptyLists = wvDoc.querySelectorAll("ul,ol");
  for (var li = emptyLists.length - 1; li >= 0; li--) {
    var lst = emptyLists[li];
    if (lst.parentNode && !lst.querySelector("li")) lst.parentNode.removeChild(lst);
  }

  var existingIds = wvDoc.querySelectorAll("[id]");
  var ids = new Set(["title"]);
  for (var ei = 0; ei < existingIds.length; ei++) ids.add(existingIds[ei].id);

  var hs = wvDoc.querySelectorAll("h1,h2,h3");
  var toc = [];
  for (var i = 0; i < hs.length; i++) {
    var h = hs[i];
    var t = h.textContent.replace(/\s+/g, " ").trim();
    if (!t) continue;
    var s = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    var slug = s, n = 1;
    while (ids.has(slug)) slug = s + "-" + (++n);
    ids.add(slug);
    h.id = slug;
    toc.push({ text: t, slug: slug, level: parseInt(h.tagName[1]) });
  }

  var ser = new XMLSerializer();
  var bh = ser.serializeToString(wvDoc.body);
  bh = bh.replace(/^<body[^>]*>/, "").replace(/<\/body>$/, "");

  console.log("=== WebView processing complete ===");
  console.log("Title:", wvArticle.title);
  console.log("Body length:", bh.length);
  console.log("TOC entries:", toc.length);

  // --- Main context processing (NO DOMParser, just JSZip) ---
  // Remove DOMParser/XMLSerializer from globals to simulate Scriptable main context
  delete globalThis.DOMParser;
  delete globalThis.XMLSerializer;
  delete globalThis.document;
  delete globalThis.Node;
  delete globalThis.Element;
  delete globalThis.DOMTokenList;

  // JSZip is available as global (set by bundle UMD and our override)
  globalThis.JSZip = npmJSZip;

  var title = _sanitizeKindleText(wvArticle.title);
  var author = _sanitizeKindleText(wvArticle.author);
  var bodyHtml = bh;
  var tocEntries = toc;

  var contentHtml =
    '<body>\n  <h1 id="title">' + _esc(title) + "</h1>\n" +
    (author ? '  <p class="byline">' + _esc(author) + "</p>\n" : "") +
    "  " + bodyHtml + "\n</body>";

  var contentXhtml = _epubXmlHeader() +
    '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n' +
    "<head><title>" + _esc(title) + "</title></head>\n" +
    contentHtml + "\n</html>";

  var navPoints = [{ label: title, src: "content.xhtml#title" }];
  for (var i = 0; i < tocEntries.length; i++) {
    if (tocEntries[i].level <= 2) {
      navPoints.push({ label: _sanitizeKindleText(tocEntries[i].text), src: "content.xhtml#" + tocEntries[i].slug });
    }
  }

  var bookId = _uuid();

  var manifest = [
    { id: "content", href: "content.xhtml", mediaType: "application/xhtml+xml" },
    { id: "css", href: "style/default.css", mediaType: "text/css" },
    { id: "ncx", href: "toc.ncx", mediaType: "application/x-dtbncx+xml" },
  ];

  var zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF").file("container.xml", _containerXml());
  var oebps = zip.folder("OEBPS");
  oebps.file("style/default.css", _KINDLE_CSS);
  oebps.file("content.xhtml", contentXhtml);
  oebps.file("content.opf", _contentOpf(title, author, manifest, ["content"], "", bookId));
  oebps.file("toc.ncx", _tocNcx(title, navPoints, bookId));

  var uint8array = await zip.generateAsync({ type: "uint8array" });

  var binary = "";
  for (var i = 0; i < uint8array.length; i++) {
    binary += String.fromCharCode(uint8array[i]);
  }
  var b64 = Buffer.from(binary, "binary").toString("base64");

  console.log("\n=== EPUB generated with JSZip ===");
  console.log("ZIP size:", uint8array.length, "bytes");
  console.log("Base64 length:", b64.length);

  // Verify
  const loaded = await npmJSZip.loadAsync(binary, { base64: false });
  const names = Object.keys(loaded.files).sort();
  console.log("\nFiles in EPUB:", names.length);
  for (const n of names) console.log("  " + n);

  // Validate structure
  const tests = [];
  tests.push({ n: "PK\x03\x04 sig", pass: uint8array[0]===0x50 && uint8array[1]===0x4b && uint8array[2]===0x03 && uint8array[3]===0x04 });
  for (const f of ["mimetype","META-INF/container.xml","OEBPS/content.opf","OEBPS/toc.ncx","OEBPS/content.xhtml","OEBPS/style/default.css"]) {
    tests.push({ n: "File: "+f, pass: !!loaded.files[f] });
  }

  const cx = await loaded.files["OEBPS/content.xhtml"].async("string");
  tests.push({ n: "XML decl", pass: cx.includes('<?xml') });
  tests.push({ n: "XHTML ns", pass: cx.includes('xmlns="http://www.w3.org/1999/xhtml"') });
  tests.push({ n: "xml:lang", pass: cx.includes('xml:lang="en"') });
  tests.push({ n: "lang", pass: cx.includes('lang="en"') });
  tests.push({ n: "No links", pass: !cx.includes('<a ') });

  const opf = await loaded.files["OEBPS/content.opf"].async("string");
  tests.push({ n: "dc:language", pass: opf.includes('<dc:language>en</dc:language>') });
  tests.push({ n: "unique-id", pass: opf.includes('unique-identifier="BookId"') });

  const ncx = await loaded.files["OEBPS/toc.ncx"].async("string");
  tests.push({ n: "NCX navMap", pass: ncx.includes('<navMap>') });

  let pass = 0, fail = 0;
  for (const t of tests) {
    if (t.pass) { console.log("PASS:", t.n); pass++; }
    else { console.log("FAIL:", t.n); fail++; }
  }
  console.log("\n===", fail === 0 ? "ALL PASSED" : fail + " FAILURES", "===");

  // Write for epubcheck
  fs.writeFileSync(path.join(ROOT, "tests", "test_output.epub"), uint8array);
  console.log("Written to tests/test_output.epub");

  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
