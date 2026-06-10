const fs = require("fs"), path = require("path"), {JSDOM} = require("jsdom"), JSZip = require("jszip");
const ROOT = path.join(__dirname, "..");

async function main() {
  const resp = await fetch("https://en.wikipedia.org/wiki/EPUB");
  const html = await resp.text();
  console.log("Fetched: " + (html.length/1024).toFixed(1) + "KB");

  const dom = new JSDOM(html);
  globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Node = dom.window.Node; globalThis.Element = dom.window.Element;
  globalThis.DOMTokenList = dom.window.DOMTokenList; globalThis.document = dom.window.document; globalThis.Set = Set;
  eval(fs.readFileSync(path.join(ROOT, "ios", "bundle.js"), "utf8"));

  var a = new Readability(new DOMParser().parseFromString(html, "text/html")).parse();
  if (!a) { console.log("FAIL: no article"); return; }
  var c = _sanitizeHtmlForEpub(stripTrailingRelated(stripUiText(_supplementContent(_restoreHeadings(a.content||""), html))));
  c = c.replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1");
  var p = new DOMParser().parseFromString(c, "text/html");
  var ids = new Set(["title"]);
  var hs = p.querySelectorAll("h1,h2,h3"); var toc = [];
  for (var i=0;i<hs.length;i++){var h=hs[i],t=(h.textContent||"").trim();if(!t)continue;var s=t.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"s",b=s,n=1;while(ids.has(s))s=b+"-"+(++n);ids.add(s);h.id=s;toc.push({text:t,slug:s,level:parseInt(h.tagName[1])})}
  var ser = new XMLSerializer();
  var bh = ser.serializeToString(p.body).replace(/^<body[^>]*>/,"").replace(/<\/body>$/,"");

  delete globalThis.DOMParser; delete globalThis.XMLSerializer; delete globalThis.document;
  delete globalThis.Node; delete globalThis.Element; delete globalThis.DOMTokenList;

  var title = _sanitizeKindleText(a.title);
  var navPoints = [{label:title,src:"content.xhtml#title"}];
  for(var i=0;i<toc.length;i++){if(toc[i].level<=2)navPoints.push({label:_sanitizeKindleText(toc[i].text),src:"content.xhtml#"+toc[i].slug})}
  var contentXhtml = _epubXmlHeader() + '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n<head><title>'+_esc(title)+'</title></head>\n<body>\n  <h1 id="title">'+_esc(title)+'</h1>\n  '+bh+'\n</body>\n</html>';
  var bookId = _uuid();
  var manifest = [{id:"content",href:"content.xhtml",mediaType:"application/xhtml+xml"},{id:"css",href:"style/default.css",mediaType:"text/css"},{id:"ncx",href:"toc.ncx",mediaType:"application/x-dtbncx+xml"}];
  var files = [
    {name:"mimetype", data:"application/epub+zip"},
    {name:"META-INF/container.xml", data:_containerXml()},
    {name:"OEBPS/style/default.css", data:_KINDLE_CSS},
    {name:"OEBPS/content.xhtml", data:contentXhtml},
    {name:"OEBPS/content.opf", data:_contentOpf(title,"",manifest,["content"],"",bookId)},
    {name:"OEBPS/toc.ncx", data:_tocNcx(title,navPoints,bookId)},
  ];
  function s2b(s){var r=[];for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);if(c<128)r.push(c);else if(c<2048)r.push(192|c>>6,128|c&63);else if(c<55296||c>=57344)r.push(224|c>>12,128|(c>>6&63),128|c&63);else if(c>=55296&&c<=56319){i++;var c2=s.charCodeAt(i);if(c2>=56320&&c2<=57343){var cp=((c-55296)<<10)+(c2-56320)+65536;r.push(240|cp>>18,128|(cp>>12&63),128|(cp>>6&63),128|cp&63)}}}var b=new Uint8Array(r.length);for(var j=0;j<r.length;j++)b[j]=r[j];return b}
  function crc32(d){var e=4294967295;for(var i=0;i<d.length;i++){e^=d[i];for(var j=0;j<8;j++)e=(e>>>1)^(e&1?3988292384:0)}return(e^4294967295)>>>0}
  var ents=[],loff=0;for(var i=0;i<files.length;i++){var d=s2b(files[i].data),nb=s2b(files[i].name);ents.push({nb:nb,d:d,crc:crc32(d),lo:loff});loff+=30+nb.length+d.length}
  var cdSize=0;for(var i=0;i<ents.length;i++)cdSize+=46+ents[i].nb.length;
  var total=loff+cdSize+22;
  var zip=new Uint8Array(total);var o=0;
  function w32(v){zip[o]=v&255;zip[o+1]=(v>>>8)&255;zip[o+2]=(v>>>16)&255;zip[o+3]=(v>>>24)&255;o+=4}
  function w16(v){zip[o]=v&255;zip[o+1]=(v>>>8)&255;o+=2}
  for(var i=0;i<ents.length;i++){var e=ents[i];w32(0x04034b50);w16(20);w16(0);w16(0);w16(0);w16(0);w32(e.crc);w32(e.d.length);w32(e.d.length);w16(e.nb.length);w16(0);for(var j=0;j<e.nb.length;j++){zip[o]=e.nb[j];o++}for(var j=0;j<e.d.length;j++){zip[o]=e.d[j];o++}}
  var cdOff=o;
  for(var i=0;i<ents.length;i++){var e=ents[i];w32(0x02014b50);w16(20);w16(20);w16(0);w16(0);w16(0);w16(0);w32(e.crc);w32(e.d.length);w32(e.d.length);w16(e.nb.length);w16(0);w16(0);w16(0);w16(0);w32(0);w32(e.lo);for(var j=0;j<e.nb.length;j++){zip[o]=e.nb[j];o++}}
  var cdSizeActual=o-cdOff;
  w32(0x06054b50);w16(0);w16(0);w16(ents.length);w16(ents.length);w32(cdSizeActual);w32(cdOff);w16(0);
  console.log("total="+total+" o="+o+" cdSize="+cdSize+" cdSizeActual="+cdSizeActual);

  const loaded = await JSZip.loadAsync(zip);
  const cx = await loaded.files["OEBPS/content.xhtml"].async("string");
  if (!cx.includes('<?xml')) { console.log("FAIL: no XML decl"); return; }
  if (!cx.includes('xmlns="http://www.w3.org/1999/xhtml"')) { console.log("FAIL: no xmlns"); return; }
  if (cx.includes("<a ")) { console.log("FAIL: has links"); return; }
  if (cx.includes("<article")||cx.includes("<section")||cx.includes("<nav")||cx.includes("<header")||cx.includes("<footer")||cx.includes("<main")||cx.includes("<figure")||cx.includes("<iframe")) {
    console.log("FAIL: illegal HTML5 elements"); return;
  }
  fs.writeFileSync(path.join(ROOT,"tests","output","wikipedia_epub.epub"),zip);
  console.log("PASS: " + toc.length + " TOC entries, " + zip.length + " bytes");
}
main().catch(e=>{console.log("FAIL:",e.message);process.exit(1)});
