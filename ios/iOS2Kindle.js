const isStandalone = !args.plainTexts || !args.plainTexts[0];
let url = args.plainTexts && args.plainTexts[0] ? args.plainTexts[0] : null;

if (!url) {
  const a = new Alert();
  a.title = "iOS2Kindle";
  a.message = "Enter article URL:";
  a.addTextField("https://...");
  a.addCancelAction("Cancel");
  a.addAction("OK");
  const idx = await a.present();
  if (idx === -1) { return; }
  url = a.textFieldValue(0);
}
if (!url) throw new Error("No URL provided");

// NOTE: Replace with your Send-to-Kindle email address.
var KINDLE_EMAIL = "your_kindle@free.kindle.com";
// NOTE: Replace with your own Google Cloud Console OAuth 2.0 credentials.
// These are deliberately blank in the repo — see AGENTS.md for setup.
var CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com";
var CLIENT_SECRET = "YOUR_CLIENT_SECRET";
var KEYCHAIN_REFRESH_KEY = "ios2kindle_gmail_refresh";
var GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
var SCOPES = "https://www.googleapis.com/auth/gmail.send";
var REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

function base64UrlSafe(b64) {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildMimeMessage(to, subject, epubBase64, filename) {
  var boundary = "BOUNDARY_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  var body = "";
  body += "To: " + to + "\r\n";
  body += "Subject: " + subject + "\r\n";
  body += "MIME-Version: 1.0\r\n";
  body += "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n";
  body += "\r\n";
  body += "--" + boundary + "\r\n";
  body += "Content-Type: text/plain; charset=\"UTF-8\"\r\n";
  body += "Content-Transfer-Encoding: 7bit\r\n";
  body += "\r\n";
  body += "Sent from iOS2Kindle\r\n";
  body += "\r\n";
  body += "--" + boundary + "\r\n";
  body += "Content-Type: application/epub+zip\r\n";
  body += "Content-Transfer-Encoding: base64\r\n";
  body += "Content-Disposition: attachment; filename=\"" + filename + "\"\r\n";
  body += "\r\n";
  for (var i = 0; i < epubBase64.length; i += 76) {
    body += epubBase64.substring(i, Math.min(i + 76, epubBase64.length)) + "\r\n";
  }
  body += "\r\n";
  body += "--" + boundary + "--\r\n";
  return body;
}

async function exchangeCodeForTokens(code) {
  var req = new Request(TOKEN_URL);
  req.method = "POST";
  req.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  req.body = "code=" + encodeURIComponent(code) +
    "&client_id=" + encodeURIComponent(CLIENT_ID) +
    "&client_secret=" + encodeURIComponent(CLIENT_SECRET) +
    "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
    "&grant_type=authorization_code";
  return await req.loadJSON();
}

async function refreshAccessToken(refreshToken) {
  var req = new Request(TOKEN_URL);
  req.method = "POST";
  req.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  req.body = "refresh_token=" + encodeURIComponent(refreshToken) +
    "&client_id=" + encodeURIComponent(CLIENT_ID) +
    "&client_secret=" + encodeURIComponent(CLIENT_SECRET) +
    "&grant_type=refresh_token";
  return await req.loadJSON();
}

async function authenticate() {
  return new Promise(function(resolve, reject) {
    var wv = new WebView();
    var authUrl = AUTH_BASE_URL + "?" +
      "client_id=" + encodeURIComponent(CLIENT_ID) +
      "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
      "&response_type=code" +
      "&scope=" + encodeURIComponent(SCOPES) +
      "&access_type=offline" +
      "&prompt=consent";

    wv.onLoadFinished = function() {
      wv.evaluateJavaScript(
        "(function(){var e=document.querySelector('.code,code,strong.code,input[readonly]');return e?(e.textContent||e.value||'').trim():null})()"
      ).then(function(code) {
        if (code && code.length > 10) {
          resolve(code);
        }
      }).catch(function() {});
    };

    wv.loadURL(authUrl);
  });
}

async function getAccessToken() {
  var refreshToken = null;
  try { refreshToken = Keychain.get(KEYCHAIN_REFRESH_KEY); } catch (e) {}

  if (!refreshToken) {
    var code = await authenticate();
    var tokenRes = await exchangeCodeForTokens(code);
    if (tokenRes.error) throw new Error("Auth error: " + (tokenRes.error_description || tokenRes.error));
    if (!tokenRes.refresh_token) throw new Error("No refresh_token in response. Check Google Cloud consent screen.");
    Keychain.set(KEYCHAIN_REFRESH_KEY, tokenRes.refresh_token);
    return tokenRes.access_token;
  }

  var refreshRes = await refreshAccessToken(refreshToken);
  if (refreshRes.error) {
    try { Keychain.remove(KEYCHAIN_REFRESH_KEY); } catch (e) {}
    throw new Error("Token expired. Re-authenticate. (" + (refreshRes.error_description || refreshRes.error) + ")");
  }
  return refreshRes.access_token;
}

try {
  const fm = FileManager.iCloud();
  const bundlePath = fm.joinPath(fm.documentsDirectory(), "web2kindle/bundle.js");
  if (!fm.fileExists(bundlePath)) throw new Error("bundle.js not found");
  const bundleCode = fm.readString(bundlePath);
  eval(bundleCode);

  const req = new Request(url);
  req.headers = { "User-Agent": "Mozilla/5.0 (iPhone; web2kindle iOS) AppleWebKit/605.1.15 (KHTML, like Gecko)" };
  const rawHtml = await req.loadString();

  const wv = new WebView();
  await wv.loadHTML("<!DOCTYPE html><html><body></body></html>");
  await wv.evaluateJavaScript(bundleCode + "; void 0");
  await wv.evaluateJavaScript("var WV_HTML = " + JSON.stringify(rawHtml) + "; void 0");

  const resultJson = await wv.evaluateJavaScript("(function(){" +
    "try{" +
      "var d=new DOMParser().parseFromString(WV_HTML,'text/html');" +
      "var a=new Readability(d).parse();" +
      "if(!a||!a.content){var fb=_extractDomArticle(WV_HTML);if(fb)a=fb;}" +
      "if(!a||!a.content)return JSON.stringify({error:'no article'});" +
      "var c=_restoreHeadings(a.content||'');" +
      "c=_supplementContent(c,WV_HTML);" +
      "c=stripUiText(c);c=stripTrailingRelated(c);" +
      "c=_sanitizeHtmlForEpub(c);" +
      "c=c.replace(/<a\\b[^>]*>(.*?)<\\/a>/gi,'$1');" +
      "var cd=new DOMParser().parseFromString(c,'text/html');" +
      "var emptyLists=cd.querySelectorAll('ul,ol');for(var li=emptyLists.length-1;li>=0;li--){var lst=emptyLists[li];if(lst.parentNode&&!lst.querySelector('li'))lst.parentNode.removeChild(lst);}" +
      "var existingIds=cd.querySelectorAll('[id]');var ids=new Set(['title']);for(var ei=0;ei<existingIds.length;ei++)ids.add(existingIds[ei].id);" +
      "var hs=cd.querySelectorAll('h1,h2,h3');var toc=[];" +
      "for(var i=0;i<hs.length;i++){" +
        "var h=hs[i];var t=h.textContent.replace(/\\s+/g,' ').trim();" +
        "if(!t)continue;" +
        "var s=t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');" +
        "var slug=s;var n=1;" +
        "while(ids.has(slug))slug=s+'-'+(++n);" +
        "ids.add(slug);h.id=slug;" +
        "toc.push({text:t,slug:slug,level:parseInt(h.tagName[1])});" +
      "}" +
      "var ser=new XMLSerializer();" +
      "var bh=ser.serializeToString(cd.body);" +
      "bh=bh.replace(/^<body[^>]*>/,'').replace(/<\\/body>$/,'');" +
      "bh=bh.replace(/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f\\u200b-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff\\u00ad]+/g,'');" +
      "var title=_sanitizeKindleText(a.title);" +
      "var author=_sanitizeKindleText(a.author||'');" +
      "var contentHtml='<body>\\n  <h1 id=\"title\">'+_esc(title)+'</h1>\\n'+(author?'  <p class=\"byline\">'+_esc(author)+'</p>\\n':'')+'  '+bh+'\\n</body>';" +
      "var contentXhtml=_epubXmlHeader()+_xhtmlDoctype()+'<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"en\" lang=\"en\">\\n<head><title>'+_esc(title)+'</title></head>\\n'+contentHtml+'\\n</html>';" +
      "var navPoints=[{label:title,src:'content.xhtml#title'}];" +
      "for(var i=0;i<toc.length;i++){if(toc[i].level<=2)navPoints.push({label:_sanitizeKindleText(toc[i].text),src:'content.xhtml#'+toc[i].slug})}" +
      "var bookId=_uuid();" +
      "var manifest=[{id:'content',href:'content.xhtml',mediaType:'application/xhtml+xml'},{id:'css',href:'style/default.css',mediaType:'text/css'},{id:'ncx',href:'toc.ncx',mediaType:'application/x-dtbncx+xml'}];" +
      "var files=[" +
        "{name:'mimetype',data:'application/epub+zip'}," +
        "{name:'META-INF/container.xml',data:_containerXml()}," +
        "{name:'OEBPS/style/default.css',data:_KINDLE_CSS}," +
        "{name:'OEBPS/content.xhtml',data:contentXhtml}," +
        "{name:'OEBPS/content.opf',data:_contentOpf(title,author,manifest,['content'],'',bookId)}," +
        "{name:'OEBPS/toc.ncx',data:_tocNcx(title,navPoints,bookId)}" +
      "];" +
      "function s2b(s){var r=[];for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);if(c<128)r.push(c);else if(c<2048)r.push(192|c>>6,128|c&63);else if(c<55296||c>=57344)r.push(224|c>>12,128|(c>>6&63),128|c&63);else if(c>=55296&&c<=56319){i++;var c2=s.charCodeAt(i);if(c2>=56320&&c2<=57343){var cp=((c-55296)<<10)+(c2-56320)+65536;r.push(240|cp>>18,128|(cp>>12&63),128|(cp>>6&63),128|cp&63)}}}var b=new Uint8Array(r.length);for(var j=0;j<r.length;j++)b[j]=r[j];return b}" +
      "function crc32(d){var z=4294967295;for(var i=0;i<d.length;i++){z^=d[i];for(var j=0;j<8;j++)z=(z>>>1)^(z&1?3988292384:0)}return(z^4294967295)>>>0}" +
      "var ents=[],loff=0;for(var i=0;i<files.length;i++){var d=s2b(files[i].data),nb=s2b(files[i].name);ents.push({nb:nb,d:d,crc:crc32(d),lo:loff});loff+=30+nb.length+d.length}" +
      "var cdSize=0;for(var i=0;i<ents.length;i++)cdSize+=46+ents[i].nb.length;" +
      "var total=loff+cdSize+22;" +
      "var zip=new Uint8Array(total);var o=0;" +
      "function w32(v){zip[o]=v&255;zip[o+1]=(v>>>8)&255;zip[o+2]=(v>>>16)&255;zip[o+3]=(v>>>24)&255;o+=4}" +
      "function w16(v){zip[o]=v&255;zip[o+1]=(v>>>8)&255;o+=2}" +
      "for(var i=0;i<ents.length;i++){var x=ents[i];w32(0x04034b50);w16(20);w16(0);w16(0);w16(0);w16(0);w32(x.crc);w32(x.d.length);w32(x.d.length);w16(x.nb.length);w16(0);for(var j=0;j<x.nb.length;j++){zip[o]=x.nb[j];o++}for(var j=0;j<x.d.length;j++){zip[o]=x.d[j];o++}}" +
      "var cdOff=o;" +
      "for(var i=0;i<ents.length;i++){var x=ents[i];w32(0x02014b50);w16(20);w16(20);w16(0);w16(0);w16(0);w16(0);w32(x.crc);w32(x.d.length);w32(x.d.length);w16(x.nb.length);w16(0);w16(0);w16(0);w16(0);w32(0);w32(x.lo);for(var j=0;j<x.nb.length;j++){zip[o]=x.nb[j];o++}}" +
      "var cdSizeActual=o-cdOff;" +
      "w32(0x06054b50);w16(0);w16(0);w16(ents.length);w16(ents.length);w32(cdSizeActual);w32(cdOff);w16(0);" +
      "var bin='';for(var i=0;i<zip.length;i++)bin+=String.fromCharCode(zip[i]);" +
      "return JSON.stringify({b64:btoa(bin),title:title,size:zip.length});" +
    "}catch(e){return JSON.stringify({error:e.message})}" +
  "})()");

  const result = JSON.parse(resultJson);
  if (result.error) throw new Error(result.error);

  if (isStandalone) {
    var safeName = result.title.replace(/[^a-zA-Z0-9 _-]/g, "").trim().substring(0, 80) || "article";

    var accessToken = await getAccessToken();
    var mime = buildMimeMessage(KINDLE_EMAIL, result.title, result.b64, safeName + ".epub");
    var raw = base64UrlSafe(btoa(unescape(encodeURIComponent(mime))));

    var sendReq = new Request(GMAIL_SEND_URL);
    sendReq.method = "POST";
    sendReq.headers = {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    };
    sendReq.body = JSON.stringify({ raw: raw });
    var sendRes = await sendReq.loadJSON();

    if (sendRes.error) throw new Error("Gmail API error: " + sendRes.error.message);

    var a = new Alert();
    a.title = "iOS2Kindle";
    a.message = "Sent to Kindle!";
    a.addAction("OK");
    await a.present();
  }

  return { title: result.title, size: result.size };

} catch (e) {
  if (isStandalone) {
    const a = new Alert();
    a.title = "iOS2Kindle Error";
    a.message = (e.message || "").substring(0, 500);
    a.addAction("OK");
    await a.present();
  }
  throw e;
}
