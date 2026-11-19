/* Climentos WMP - browser-local preferences; identity comes from the Flask session. */
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  // global.js validates the Flask session and populates the shared user identity.
  // Settings never infer a role or user from localStorage or URL parameters.

  const key = "climentos-workspace-settings-demo";
  const defaults = {
    workspaceName: "Climentos Work Management Platform",
    language: "en",
    dateFormat: "DD MMM YYYY",
    timezone: "Asia/Kolkata",
    notifyNewTicket: true,
    notifyAssigned: true,
    notifyStatus: true,
    notifySummary: false,
    defaultPriority: "Medium",
    defaultStatus: "Open",
    ticketPrefix: "CLM",
    responseTarget: "1",
    strongPasswords: true,
    sessionReminder: true,
  };
  const fields = Object.keys(defaults);
  let settings = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    settings = { ...settings, ...saved };
  } catch (_) {}

  function apply() {
    fields.forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (el.type === "checkbox") el.checked = Boolean(settings[id]);
      else el.value = settings[id] ?? defaults[id];
    });
  }

  function collect() {
    fields.forEach((id) => {
      const el = $(id);
      if (el)
        settings[id] = el.type === "checkbox" ? el.checked : el.value.trim();
    });
  }

  function save() {
    collect();
    if (!settings.workspaceName || !settings.ticketPrefix) {
      $("settingsSaveMessage").textContent =
        "Workspace name and ticket prefix are required.";
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(settings));
      $("settingsSaveMessage").textContent =
        "Settings saved in this browser (demo mode).";
    } catch (_) {
      $("settingsSaveMessage").textContent =
        "Unable to save settings in this browser.";
    }
  }

  apply();
  $("saveSettings")?.addEventListener("click", save);
  $("saveAllSettings")?.addEventListener("click", save);

  $("resetSettings")?.addEventListener("click", () => {
    if (!confirm("Reset all settings to their default values?")) return;
    settings = { ...defaults };
    apply();
    save();
  });

  document.querySelectorAll(".settings-nav-item").forEach((btn) =>
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".settings-nav-item")
        .forEach((x) => x.classList.toggle("active", x === btn));
      const section = $(btn.dataset.target);
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
    }),
  );

  $("settingsSearch")?.addEventListener("input", () => {
    const q = $("settingsSearch").value.trim().toLowerCase();
    document.querySelectorAll(".settings-section").forEach((s) => {
      s.hidden = !!q && !s.textContent.toLowerCase().includes(q);
    });
  });

  // Settings page theme handling
  const themeToggle = $("themeToggle");
  const themeIcon = $("themeIcon");
  const themeKey = "climentos-theme";

  let savedTheme = "light";

  try {
    savedTheme = localStorage.getItem(themeKey) || "light";
  } catch (_) {}

  function applyTheme(dark) {
    document.body.classList.toggle("dark-theme", dark);

    if (themeIcon) {
      themeIcon.textContent = dark ? "☀" : "☾";
    }

    if (themeToggle) {
      themeToggle.setAttribute(
        "aria-label",
        dark ? "Switch to light mode" : "Switch to dark mode"
      );
      themeToggle.setAttribute("aria-pressed", String(dark));
    }
  }

  applyTheme(savedTheme === "dark");

  themeToggle?.addEventListener("click", () => {
    const dark = !document.body.classList.contains("dark-theme");

    applyTheme(dark);

    try {
      localStorage.setItem(themeKey, dark ? "dark" : "light");
    } catch (_) {}
  });


});
