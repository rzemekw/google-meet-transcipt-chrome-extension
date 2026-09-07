// Forwards caption lines from content.js to the native host, one process per line,
// strictly in order. The host is stateless: it resolves the file from the message.
const HOST = "com.rzemekw.meet_transcript";

let queue = Promise.resolve();

function sendToHost(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { ok: false, error: "empty response" });
      }
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  queue = queue.then(() => sendToHost(message)).then((result) => {
    if (!result.ok) console.error("meet-transcript host error:", result.error, message);
    sendResponse(result);
  });
  return true;
});
