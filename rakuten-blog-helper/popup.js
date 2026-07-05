const openAppButton = document.getElementById("open-app");

openAppButton.addEventListener("click", async () => {
  const appUrl = chrome.runtime.getURL("app.html");
  await chrome.tabs.create({ url: appUrl });
  window.close();
});
