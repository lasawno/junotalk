/**
 * Juno Extension — Service Worker (Manifest V3)
 *
 * Single responsibility: open the Juno side panel when the
 * extension icon is clicked. No data is collected here.
 *
 * Security: generates a stable device token on first install,
 * stored in chrome.storage.local. Sent as X-Juno-Device header
 * with every API request so the server can rate-limit per device.
 */

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await ensureDeviceToken();
    chrome.tabs.create({ url: "disclosure.html" });
  }
});

/**
 * Generates a UUID-style device token using the Web Crypto API
 * and stores it in chrome.storage.local under "junoDeviceId".
 * If a token already exists it is left unchanged.
 */
async function ensureDeviceToken() {
  const stored = await chrome.storage.local.get("junoDeviceId");
  if (stored.junoDeviceId) return;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;

  await chrome.storage.local.set({ junoDeviceId: uuid });
  console.log("[Juno] Device token initialized");
}
