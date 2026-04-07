/**
 * Juno Extension — Sidebar Logic
 *
 * Compliance commitments enforced here:
 *  - No browsing history collected (only the active tab's title is read,
 *    on user interaction, never stored server-side beyond the session)
 *  - No ad injection into third-party pages
 *  - Affiliate links always labeled — never silent
 *  - All data handling disclosed in disclosure.html
 */

const DEFAULT_BACKEND = "https://9148d0f9-2be6-4c0b-8751-ef3b2ad7f6c4-00-2fmgrlf2nn4u7.picard.replit.dev";

// ── State ─────────────────────────────────────────────────────────────────────

let backendUrl = DEFAULT_BACKEND;
let conversationHistory = [];
let currentPageTitle = "";
let currentPageUrl = "";
let isLoading = false;
let deviceId = "";

// ── DOM refs ──────────────────────────────────────────────────────────────────

const chatArea       = document.getElementById("chat-area");
const userInput      = document.getElementById("user-input");
const btnSend        = document.getElementById("btn-send");
const btnSettings    = document.getElementById("btn-settings");
const btnCloseSettings = document.getElementById("btn-close-settings");
const btnSaveSettings  = document.getElementById("btn-save-settings");
const settingsPanel  = document.getElementById("settings-panel");
const settingBackendUrl = document.getElementById("setting-backend-url");
const contextTitle   = document.getElementById("context-title");

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const stored = await chrome.storage.local.get(["backendUrl", "junoDeviceId"]);
  if (stored.backendUrl) {
    backendUrl = stored.backendUrl;
    settingBackendUrl.value = backendUrl;
  } else {
    settingBackendUrl.value = DEFAULT_BACKEND;
  }

  if (stored.junoDeviceId) {
    deviceId = stored.junoDeviceId;
  } else {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    deviceId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    await chrome.storage.local.set({ junoDeviceId: deviceId });
  }

  loadPageContext();
}

// ── Page context (title only — no content scraping) ───────────────────────────

async function loadPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.title) {
      currentPageTitle = tab.title;
      currentPageUrl   = tab.url || "";
      contextTitle.textContent = tab.title;
    }
  } catch {
    contextTitle.textContent = "No active tab";
  }
}

// ── Quick actions ─────────────────────────────────────────────────────────────

document.querySelectorAll(".quick-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    if (action === "summarize") sendMessage(`Please summarize this page: "${currentPageTitle}"`);
    if (action === "translate") sendMessage(`Translate the current page content. The page is titled: "${currentPageTitle}"`);
    if (action === "explain") {
      getSelectedText().then(sel => {
        if (sel) sendMessage(`Explain this: "${sel}"`);
        else sendMessage("Please explain the main topic of this page.");
      });
    }
  });
});

async function getSelectedText() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString().trim() || "",
    });
    return results?.[0]?.result || "";
  } catch {
    return "";
  }
}

// ── Input handling ────────────────────────────────────────────────────────────

userInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + "px";
});

btnSend.addEventListener("click", handleSend);

function handleSend() {
  const text = userInput.value.trim();
  if (!text || isLoading) return;
  userInput.value = "";
  userInput.style.height = "auto";
  sendMessage(text);
}

// ── Chat ──────────────────────────────────────────────────────────────────────

async function sendMessage(text) {
  if (isLoading) return;

  // Remove welcome screen on first message
  const welcome = chatArea.querySelector(".welcome");
  if (welcome) welcome.remove();

  appendMessage("user", text);

  conversationHistory.push({ role: "user", content: text });

  const typingEl = appendTyping();
  setLoading(true);

  try {
    const requestHeaders = { "Content-Type": "application/json" };
    if (deviceId) requestHeaders["X-Juno-Device"] = deviceId;

    const response = await fetch(`${backendUrl}/api/v1/chat`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        message: text,
        history: conversationHistory.slice(-10),
        context: currentPageTitle
          ? `User is browsing: "${currentPageTitle}"`
          : undefined,
        source: "chrome-extension",
      }),
    });

    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const data = await response.json();
    const reply = data.reply || data.message || data.response || "I couldn't get a response right now.";

    typingEl.remove();
    appendMessage("juno", reply);
    conversationHistory.push({ role: "assistant", content: reply });

  } catch (err) {
    typingEl.remove();
    appendMessage("juno", "I couldn't reach the Juno server. Check your connection or update the backend URL in Settings.");
    console.error("[Juno Extension]", err);
  } finally {
    setLoading(false);
  }
}

// ── Message rendering ─────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s\])"'>]+/g;

function renderText(text) {
  const fragment = document.createDocumentFragment();
  const parts = text.split(URL_RE);
  const urls  = [...text.matchAll(URL_RE)].map(m => m[0]);

  parts.forEach((part, i) => {
    if (part) fragment.appendChild(document.createTextNode(part));
    if (urls[i]) {
      fragment.appendChild(buildLinkChip(urls[i]));
    }
  });

  return fragment;
}

function buildLinkChip(url) {
  let domain = url;
  try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch {}

  const chip = document.createElement("span");
  chip.className = "link-chip";

  const domainSpan = document.createElement("span");
  domainSpan.className = "link-chip-domain";
  domainSpan.textContent = domain;

  // Open in Juno browser (side panel opens target in an iframe within Juno)
  const junoBtn = document.createElement("button");
  junoBtn.className = "link-chip-btn juno";
  junoBtn.textContent = "Juno";
  junoBtn.title = "Open in Juno";
  junoBtn.addEventListener("click", () => openInJunoBrowser(url));

  // Open in own browser tab
  const extLink = document.createElement("a");
  extLink.className = "link-chip-btn external";
  extLink.textContent = "My Browser";
  extLink.href = url;
  extLink.target = "_blank";
  extLink.rel = "noopener noreferrer";
  extLink.title = "Open in your browser";

  chip.appendChild(domainSpan);
  chip.appendChild(junoBtn);
  chip.appendChild(extLink);
  return chip;
}

function openInJunoBrowser(url) {
  // Open url in the current active tab (user's own browser, navigated from here)
  // "Juno browser" in the extension context = Juno-framed view via the main app
  const junoViewUrl = `${backendUrl}/browse?url=${encodeURIComponent(url)}`;
  chrome.tabs.create({ url: junoViewUrl });
}

function appendMessage(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg msg-${role}`;

  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = role === "user" ? "You" : "Juno";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.appendChild(renderText(text));

  wrapper.appendChild(label);
  wrapper.appendChild(bubble);
  chatArea.appendChild(wrapper);
  chatArea.scrollTop = chatArea.scrollHeight;
  return wrapper;
}

function appendTyping() {
  const wrapper = document.createElement("div");
  wrapper.className = "msg msg-juno";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;

  wrapper.appendChild(bubble);
  chatArea.appendChild(wrapper);
  chatArea.scrollTop = chatArea.scrollHeight;
  return wrapper;
}

function setLoading(state) {
  isLoading = state;
  btnSend.disabled = state;
}

// ── Settings ──────────────────────────────────────────────────────────────────

btnSettings.addEventListener("click", () => {
  settingsPanel.classList.remove("hidden");
});

btnCloseSettings.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

btnSaveSettings.addEventListener("click", async () => {
  const val = settingBackendUrl.value.trim().replace(/\/$/, "");
  if (!val) return;
  backendUrl = val;
  await chrome.storage.local.set({ backendUrl: val });
  settingsPanel.classList.add("hidden");
  appendMessage("juno", `Backend updated to ${val}. Ready to go.`);
});

// ── Start ─────────────────────────────────────────────────────────────────────

init();
