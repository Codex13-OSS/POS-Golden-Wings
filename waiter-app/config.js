(function () {
  const stored = localStorage.getItem("GOLDEN_WINGS_BACKEND_URL")
    || localStorage.getItem("DEKU_BACKEND_URL");
  if (stored) {
    localStorage.setItem("GOLDEN_WINGS_BACKEND_URL", stored);
  }
  window.DEKU_CONFIG = {
    baseUrl: stored || "http://localhost:3000"
  };
})();
