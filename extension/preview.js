var undoStack = [];
var _selectedBlock = null;
var _url = "";
var _epubBase64 = "";

function sendEmailViaBackground(epubBase64, title, url, filename) {
  return new Promise(function(resolve, reject) {
    filename = (filename || "article").replace(/[^A-Za-z0-9._ -]/g, "").trim() || "article";
    if (!filename.endsWith(".epub")) filename += ".epub";
    chrome.runtime.sendMessage({ action: "sendEmail", epub: epubBase64, title: title, url: url, filename: filename }, function(resp) {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (resp.error) return reject(new Error(resp.error));
      resolve(resp);
    });
  });
}

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function _shouldAutoRotate(w, h) { return w > 500 && Math.min(w, h) >= 120 && w / h > 1.2; }

function _rotateImg(img, deg) {
  var wrap = img && img.closest(".imgwrap");
  if (!wrap) return;
  deg = deg % 360;
  wrap.setAttribute("data-rot", deg);
  if (deg === 0) {
    img.style.transform = "";
    img.style.width = "";
    img.style.height = "";
    img.style.maxWidth = "";
    img.style.objectFit = "";
    img.style.margin = "";
    return;
  }
  var nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return;
  var cw = wrap.parentElement ? wrap.parentElement.clientWidth || 700 : 700;
  if (deg === 90 || deg === 270) {
    var scale = cw / nh;
    var layoutW = Math.round(nw * scale);
    var layoutH = Math.round(nh * scale);
    var overlap = Math.round((layoutW - layoutH) / 2);
    img.style.width = layoutW + "px";
    img.style.height = layoutH + "px";
    img.style.maxWidth = "none";
    img.style.objectFit = "contain";
    img.style.transform = "rotate(" + deg + "deg)";
    img.style.margin = overlap + "px 0";
  } else {
    img.style.transform = "rotate(180deg)";
    img.style.width = "";
    img.style.height = "";
    img.style.maxWidth = "";
    img.style.objectFit = "";
    img.style.margin = "";
  }
}

function toggleEdit() {
  document.body.classList.toggle("p2k-editing");
  document.getElementById("p2k-edit").classList.toggle("active");
  if (!document.body.classList.contains("p2k-editing") && _selectedBlock) {
    _selectedBlock.classList.remove("p2k-selected");
    _selectedBlock = null;
  }
}

function rmSec(rmEl) {
  var sec = rmEl.closest(".p2k-section");
  if (!sec || sec.classList.contains("p2k-removed")) return;
  _remove(sec);
}

function removeBlock(el) {
  if (!el || el.classList.contains("p2k-removed")) return;
  el.classList.add("p2k-removed");
  undoStack.push({ kind: "b", el: el });
  _showUndo();
  msg("Block removed");
}

function _remove(el) {
  if (el.classList.contains("p2k-removed")) return;
  el.classList.add("p2k-removed");
  undoStack.push({ kind: "s", el: el });
  _showUndo();
  msg("Section removed");
}

function undoRm() {
  var entry = undoStack.pop();
  if (!entry) return;
  entry.el.classList.remove("p2k-removed");
  if (!undoStack.length) _hideUndo();
  msg("Undone");
}

function _showUndo() { document.getElementById("p2k-undo").style.display = ""; }
function _hideUndo() { document.getElementById("p2k-undo").style.display = "none"; }

function msg(t) {
  var m = document.getElementById("p2k-msg");
  if (!m) return;
  m.textContent = t;
  setTimeout(function () { m.textContent = ""; }, 3000);
}

function blobToDataUrl(blob) {
  return new Promise(function(resolve) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.readAsDataURL(blob);
  });
}

async function sendToKindle() {
  var title = document.getElementById("p2k-title").value.trim() || "Article";
  var btn = document.querySelector(".p2k-bar button:not(.p2k-ghost)");
  btn.disabled = true;
  btn.textContent = "Sending…";
  msg("Sending to Kindle…");
  try {
    if (!_epubBase64) throw new Error("EPUB data not found. Close and try again from the popup.");
    var filename = (title || "article").replace(/[^a-zA-Z0-9 _.-]/g, "").trim() || "article";
    var result = await sendEmailViaBackground(_epubBase64, title, _url, filename + ".epub");
    msg("Sent to Kindle!"); btn.textContent = "✓ Sent";
    recordSend(title, _url, "sent");
  } catch (e) {
    msg("Error: " + e.message); btn.disabled = false; btn.textContent = "Send to Kindle";
  }
}

function wrapSections(html) {
  var parts = html.split(/(?=<h[234]\b)/i);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    out.push('<div class="p2k-section">' + parts[i] + '</div>');
  }
  return out.join("\n");
}

var BLOCK_SEL = "p,figure,.imgwrap,img,blockquote,ul,ol,pre,h2,h3,h4,table,li";

function initBlockSelection(container) {
  container.querySelectorAll(BLOCK_SEL).forEach(function (el) {
    el.addEventListener("click", function (e) {
      if (!document.body.classList.contains("p2k-editing")) return;
      if (e.target.closest(".p2k-rm") || e.target.closest(".p2k-rot")) return;
      e.stopPropagation();
      if (_selectedBlock && _selectedBlock !== el) {
        _selectedBlock.classList.remove("p2k-selected");
      }
      if (_selectedBlock === el) {
        _selectedBlock.classList.remove("p2k-selected");
        _selectedBlock = null;
        return;
      }
      _selectedBlock = el;
      el.classList.add("p2k-selected");
    });
  });
}

function init(data) {
  var metaHtml = data.metaHtml || "";
  _url = data.url || "";
  _epubBase64 = data.epubBase64 || "";
  var escTitle = esc(data.title || "Article");
  var safeTitle = escTitle.replace(/[^a-zA-Z0-9_ -]/g, "").trim().slice(0, 80) || "article";
  var sectionsHtml = wrapSections(data.content || "");

  document.title = escTitle + " — Preview";
  document.getElementById("loading").remove();

  var toolbar = document.createElement("div");
  toolbar.className = "p2k-bar";
  toolbar.innerHTML =
    '<button class="p2k-ghost" id="p2k-edit">✂ Edit</button>' +
    '<input id="p2k-title" class="p2k-title" value="' + escTitle + '">' +
    '<button id="p2k-send">Send to Kindle</button>' +
    '<button class="p2k-ghost" id="p2k-undo" style="display:none">↩ Undo</button>' +
    '<span class="p2k-msg" id="p2k-msg"></span>';
  document.body.prepend(toolbar);

  var h1 = document.createElement("h1");
  h1.textContent = data.title || "Article";
  document.body.appendChild(h1);

  if (metaHtml) {
    var p = document.createElement("p");
    p.className = "meta";
    p.textContent = metaHtml;
    document.body.appendChild(p);
  }

  if (data.detailsHtml) {
    var detailsDiv = document.createElement("div");
    detailsDiv.className = "p2k-details";
    detailsDiv.innerHTML = data.detailsHtml;
    document.body.appendChild(detailsDiv);
  }

  var contentDiv = document.createElement("div");
  contentDiv.id = "p2k-content";
  contentDiv.innerHTML = sectionsHtml;
  document.body.appendChild(contentDiv);

  // Add remove buttons to each section
  var sections = contentDiv.querySelectorAll(".p2k-section");
  for (var i = 0; i < sections.length; i++) {
    var rm = document.createElement("div");
    rm.className = "p2k-rm";
    rm.textContent = "✕";
    rm.addEventListener("click", function (e) { rmSec(e.currentTarget); e.stopPropagation(); });
    sections[i].insertBefore(rm, sections[i].firstChild);
  }

  // Wire block-level selection
  initBlockSelection(contentDiv);

  // Wrap images with rotate buttons
  contentDiv.querySelectorAll("img").forEach(function (img) {
    if (img.closest(".p2k-rm")) return;
    if (img.parentElement.classList.contains("imgwrap")) return;
    var wrap = document.createElement("div");
    wrap.className = "imgwrap";
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    var rot = document.createElement("button");
    rot.className = "p2k-rot";
    rot.textContent = "\u21BB";
    rot.title = "Rotate image";
    rot.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var cur = parseInt(wrap.getAttribute("data-rot") || "0");
      _rotateImg(img, cur + 90);
    });
    wrap.appendChild(rot);
    if (img.naturalWidth > 0) {
      if (_shouldAutoRotate(img.naturalWidth, img.naturalHeight)) _rotateImg(img, 90);
    } else {
      img.addEventListener("load", function () {
        if (_shouldAutoRotate(img.naturalWidth, img.naturalHeight)) _rotateImg(img, 90);
      });
    }
  });

  // Wire event listeners
  document.getElementById("p2k-edit").addEventListener("click", toggleEdit);
  document.getElementById("p2k-send").addEventListener("click", sendToKindle);
  document.getElementById("p2k-undo").addEventListener("click", undoRm);

  // Deselect on click outside
  document.addEventListener("click", function () {
    if (_selectedBlock) {
      _selectedBlock.classList.remove("p2k-selected");
      _selectedBlock = null;
    }
  });

  // Keyboard handler: Delete/Backspace removes selected block
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Backspace" || e.key === "Delete") &&
        _selectedBlock &&
        document.body.classList.contains("p2k-editing")) {
      e.preventDefault();
      removeBlock(_selectedBlock);
      _selectedBlock = null;
    }
  });

  msg("Preview ready");
}

chrome.storage.local.get("preview_data", function (result) {
  if (!result.preview_data) {
    document.getElementById("loading").innerHTML = "<p style='color:#dc2626'>Preview data not found. Close this tab and try again.</p>";
    return;
  }
  var openerTabId = result.preview_data.openerTabId;
  init(result.preview_data);
  chrome.storage.local.remove("preview_data");
  if (openerTabId) {
    window.addEventListener("pagehide", function () {
      chrome.tabs.update(openerTabId, { active: true });
    });
  }
});
