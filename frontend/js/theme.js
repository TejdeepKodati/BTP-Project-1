

(function () {
  const STORAGE_KEY = "cyclesafe-theme";

  function preferredTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const label = document.querySelector(".theme-toggle-label");
    if (label) label.textContent = theme === "dark" ? "Dark mode" : "Light mode";
  }

  applyTheme(preferredTheme());

  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      document.dispatchEvent(new CustomEvent("cyclesafe:theme-changed", { detail: { theme: next } }));
    });
  });
})();
