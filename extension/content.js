// Runs on every meet.google.com page. Once the in-call toolbar appears it turns captions
// on, watches the captions region and sends each finished caption block to background.js.
//
// Meet DOM facts this relies on (verified 2026-09, may drift with Meet updates):
//  - toolbar icons are elements with class "google-symbols" whose text is the icon name;
//    the captions toggle shows "closed_caption_off" when off and "closed_caption" when on;
//  - captions render inside a div[role="region"][tabindex="0"], one block per utterance,
//    each block = [speaker element][text element] as sibling elements; other short-lived
//    regions match the same selector, so every match is observed;
//  - Meet keeps editing the text of a block while its person speaks, several blocks at once
//    when people talk over each other, and corrects the last few words of a block it already
//    stopped editing;
//  - a block that is scrolled away or fades out is removed from the DOM;
//  - the current user's own captions are labelled "Ty" / "You"; that label is kept as is.

(() => {
  const REGION_SELECTOR = 'div[role="region"][tabindex="0"]';
  const TITLE_SELECTOR = ".u6vdEc";
  const TICK_MS = 1000;
  const CAPTIONS_CLICK_COOLDOWN_MS = 10000;
  // Meet drops a very long single-speaker block and starts it over; a shrink this large
  // means a new block began inside the same element.
  const RESTART_SHRINK_CHARS = 250;
  // A block that stopped changing is written out after this pause; if the same block
  // grows afterwards only the new words are written.
  const IDLE_FLUSH_MS = 8000;
  // Meet still corrects the last few written words (e.g. two words replaced by one); up to
  // this many changed trailing words are written again, a larger difference means the
  // block started over.
  const CORRECTED_TAIL_WORDS = 4;

  const observers = new Map(); // region element -> MutationObserver
  const pendings = new Map(); // block element -> { speaker, text, startedAt, changedAt }
  const writtenTexts = new Map(); // block element -> text already written for it
  let lastCaptionsClick = 0;
  let timer = null;

  function log(...args) {
    console.log("[meet-transcript]", ...args);
  }

  function meetingCode() {
    const path = location.pathname.replace(/^\/+|\/+$/g, "");
    return path || "unknown";
  }

  function meetingTitle() {
    const el = document.querySelector(TITLE_SELECTOR);
    const title = el && el.textContent.trim();
    return title || meetingCode();
  }

  function captionsIcon() {
    for (const icon of document.querySelectorAll(".google-symbols")) {
      const name = icon.textContent.trim();
      if (name === "closed_caption_off" || name === "closed_caption") return icon;
    }
    return null;
  }

  function ensureCaptionsOn() {
    const icon = captionsIcon();
    if (!icon || icon.textContent.trim() !== "closed_caption_off") return;
    const now = Date.now();
    if (now - lastCaptionsClick < CAPTIONS_CLICK_COOLDOWN_MS) return;
    const button = icon.closest("button") || icon.parentElement;
    if (!button) return;
    lastCaptionsClick = now;
    button.click();
    log("captions turned on");
  }

  function textOf(el) {
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  }

  // A caption block: last child holds the text, the child before it the speaker name.
  function isBlock(el) {
    if (!el || observers.has(el) || el.children.length < 2) return false;
    const textEl = el.children[el.children.length - 1];
    const nameEl = el.children[el.children.length - 2];
    if (textEl.querySelector("div, img")) return false;
    const name = textOf(nameEl);
    return name.length > 0 && name.length <= 80 && textOf(textEl).length > 0;
  }

  function blockFrom(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el !== document.body && !observers.has(el)) {
      if (isBlock(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function readBlock(el) {
    const textEl = el.children[el.children.length - 1];
    const nameEl = el.children[el.children.length - 2];
    return { speaker: textOf(nameEl), text: textOf(textEl) };
  }

  function touchedBlocks(mutations) {
    const blocks = new Set();
    const consider = (node) => {
      const block = blockFrom(node);
      if (block) blocks.add(block);
    };
    for (const m of mutations) {
      consider(m.target);
      m.addedNodes.forEach(consider);
    }
    return blocks;
  }

  function unwrittenText(el, text) {
    const writtenText = writtenTexts.get(el);
    if (writtenText === undefined) return text;
    const before = writtenText.split(" ");
    const now = text.split(" ");
    let common = 0;
    while (common < before.length && common < now.length && before[common] === now[common]) common += 1;
    if (common < before.length - CORRECTED_TAIL_WORDS) return text;
    return now.slice(common).join(" ");
  }

  // After the extension is reloaded the old content script keeps running on the page
  // without chrome.runtime; it stops itself and the reloaded copy takes over on refresh.
  function orphaned() {
    if (chrome.runtime && chrome.runtime.id) return false;
    clearInterval(timer);
    for (const observer of observers.values()) observer.disconnect();
    observers.clear();
    pendings.clear();
    log("extension reloaded, refresh this tab");
    return true;
  }

  function send(line) {
    chrome.runtime.sendMessage(line, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[meet-transcript] send failed:", chrome.runtime.lastError.message);
      } else if (response && !response.ok) {
        console.error("[meet-transcript] host refused:", response.error);
      }
    });
  }

  function flush(el) {
    const pending = pendings.get(el);
    pendings.delete(el);
    if (!pending || orphaned()) return;
    const text = unwrittenText(el, pending.text);
    writtenTexts.set(el, pending.text);
    if (!text) return;
    send({
      code: meetingCode(),
      title: meetingTitle(),
      ts: pending.startedAt,
      speaker: pending.speaker,
      text,
    });
  }

  function inDocumentOrder(elements) {
    return [...elements].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
  }

  function flushAll() {
    for (const el of inDocumentOrder(pendings.keys())) flush(el);
  }

  function startPending(el, current) {
    pendings.set(el, { ...current, startedAt: new Date().toISOString(), changedAt: Date.now() });
  }

  function track(el) {
    const current = readBlock(el);
    if (!current.text) return;
    const pending = pendings.get(el);
    if (!pending) {
      startPending(el, current);
      return;
    }
    const restarted = current.text.length < pending.text.length - RESTART_SHRINK_CHARS;
    if (pending.speaker !== current.speaker || restarted) {
      flush(el);
      writtenTexts.delete(el);
      startPending(el, current);
      return;
    }
    if (current.text !== pending.text) {
      pending.text = current.text;
      pending.changedAt = Date.now();
    }
  }

  function flushFinished() {
    const now = Date.now();
    const finished = [...pendings].filter(
      ([el, p]) => !document.contains(el) || !isBlock(el) || now - p.changedAt > IDLE_FLUSH_MS
    );
    for (const el of inDocumentOrder(finished.map(([el]) => el))) flush(el);
    for (const el of writtenTexts.keys()) {
      if (!document.contains(el)) writtenTexts.delete(el);
    }
  }

  function onMutations(mutations) {
    flushFinished();
    for (const block of touchedBlocks(mutations)) track(block);
  }

  function syncRegions() {
    for (const [region, observer] of observers) {
      if (document.contains(region)) continue;
      observer.disconnect();
      observers.delete(region);
    }
    for (const region of document.querySelectorAll(REGION_SELECTOR)) {
      if (observers.has(region)) continue;
      const observer = new MutationObserver(onMutations);
      observer.observe(region, { childList: true, characterData: true, subtree: true });
      observers.set(region, observer);
      log("watching region", region.getAttribute("aria-label") || "(no label)");
    }
  }

  function tick() {
    if (orphaned()) return;
    flushFinished();
    ensureCaptionsOn();
    syncRegions();
  }

  timer = setInterval(tick, TICK_MS);
  window.addEventListener("pagehide", flushAll);
  log("loaded");
})();
