(function () {
  const THEME_KEY = "GOLDEN_WINGS_THEME";

  function systemPreference() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function getTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") {
      return stored;
    }
    return systemPreference();
  }

  function applyTheme(theme) {
    const resolved = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", resolved);
    document.body && document.body.setAttribute("data-theme", resolved);
    localStorage.setItem(THEME_KEY, resolved);
    updateThemeButtons(resolved);
  }

  function updateThemeButtons(theme) {
    const buttons = document.querySelectorAll("[data-theme-toggle]");
    buttons.forEach((button) => {
      button.textContent = theme === "dark" ? "Modo claro" : "Modo oscuro";
      button.setAttribute("aria-label", button.textContent);
      button.setAttribute("data-theme-current", theme);
    });
  }

  function initThemeButtons() {
    const current = getTheme();
    applyTheme(current);
    const buttons = document.querySelectorAll("[data-theme-toggle]");
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const activeTheme = document.documentElement.getAttribute("data-theme") || "dark";
        applyTheme(activeTheme === "dark" ? "light" : "dark");
      });
    });
  }

  window.GoldenWingsTheme = {
    getTheme,
    applyTheme,
    initThemeButtons
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThemeButtons);
  } else {
    initThemeButtons();
  }
})();
