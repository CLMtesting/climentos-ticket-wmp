/* Climentos WMP: Flask-session authentication and shared UI behavior. */
document.addEventListener("DOMContentLoaded", async () => {
  const LOGIN = "/pages/login.html";
  const DASHBOARD = "/pages/dashboard.html";

  let session;
  try {
    if (typeof getCurrentUser !== "function")
      throw new Error("api.js must load before global.js.");
    const response = await getCurrentUser();
    session = response.user || response;
    if (!session || !session.role) throw new Error("Invalid session.");
  } catch (error) {
    console.warn("Session verification failed:", error.message);
    window.location.replace(LOGIN);
    return;
  }

  const role = String(session.role).toUpperCase();

  // Shared theme behavior. Settings currently owns its own theme handler.
  const currentPage = location.pathname.split("/").pop() || "dashboard.html";
  if (currentPage !== "settings.html") {
    const themeToggle = document.getElementById("themeToggle");
    const themeIcon = document.getElementById("themeIcon");
    const themeKey = "climentos-theme";

    let savedTheme = "light";
    try {
      savedTheme = localStorage.getItem(themeKey) || "light";
    } catch (error) {
      console.warn("Unable to read saved theme preference:", error);
    }

    const applyTheme = (dark) => {
      document.body.classList.toggle("dark-theme", dark);
      if (themeIcon) themeIcon.textContent = dark ? "☀" : "☾";
      if (themeToggle) {
        themeToggle.setAttribute(
          "aria-label",
          dark ? "Switch to light mode" : "Switch to dark mode",
        );
        themeToggle.setAttribute("aria-pressed", String(dark));
      }
    };

    applyTheme(savedTheme === "dark");

    themeToggle?.addEventListener("click", () => {
      const dark = !document.body.classList.contains("dark-theme");
      applyTheme(dark);
      try {
        localStorage.setItem(themeKey, dark ? "dark" : "light");
      } catch (error) {
        console.warn("Unable to save theme preference:", error);
      }
    });
  }

  // Centralized notification entry point.
  const topbarRight = document.querySelector(".topbar-right");
  let notificationButton = document.getElementById("notificationButton");

  if (!notificationButton && topbarRight) {
    notificationButton = document.createElement("button");
    notificationButton.type = "button";
    notificationButton.id = "notificationButton";
    notificationButton.className = "icon-button notification-button";
    topbarRight.insertBefore(
      notificationButton,
      document.getElementById("themeToggle") || topbarRight.firstChild,
    );
  }

  if (notificationButton) {
    notificationButton.classList.add("notification-button");
    notificationButton.type = "button";
    notificationButton.setAttribute("aria-label", "Notifications");
    notificationButton.setAttribute("title", "Notifications");
    notificationButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path>
        <path d="M10 21h4"></path>
      </svg>
      <span class="notification-count-badge" hidden aria-live="polite"></span>`;

    notificationButton.addEventListener("click", () => {
      window.location.href = "notifications.html";
    });
  }

  const notificationBadge = notificationButton?.querySelector(
    ".notification-count-badge",
  );

  window.refreshNotificationBadge = async function () {
    if (typeof getNotifications !== "function" || !notificationBadge) return;

    try {
      const result = await getNotifications(1);
      const unread = Math.max(0, Number(result.counts?.unread || 0));

      notificationBadge.textContent = unread > 99 ? "99+" : String(unread);
      notificationBadge.hidden = unread === 0;

      notificationButton.setAttribute(
        "aria-label",
        unread ? `Notifications, ${unread} unread` : "Notifications",
      );
    } catch (error) {
      console.warn("Unable to refresh notification badge:", error.message);
    }
  };

  window.refreshNotificationBadge();

  window.setInterval(() => {
    if (!document.hidden) window.refreshNotificationBadge();
  }, 60000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) window.refreshNotificationBadge();
  });

  window.addEventListener("focus", () => window.refreshNotificationBadge());

  // Logged-in user information.
  const name = session.name || session.full_name || session.fullName || "User";
  const label = role.charAt(0) + role.slice(1).toLowerCase();

  document.querySelectorAll(".user-name").forEach((el) => {
    el.textContent = name;
  });

  document.querySelectorAll(".user-role").forEach((el) => {
    el.textContent = label;
  });

  document.querySelectorAll(".user-initial").forEach((el) => {
    el.textContent = name.trim().charAt(0).toUpperCase() || "U";
  });

  // Dashboard welcome message.
  const welcome = document.getElementById("welcomeTitle");

  if (welcome) {
    const first = name.trim().split(/\s+/)[0] || "there";
    const hour = new Date().getHours();

    const greeting =
      hour < 12
        ? "Good morning"
        : hour < 17
          ? "Good afternoon"
          : "Good evening";

    welcome.replaceChildren(document.createTextNode(`${greeting}, ${first} `));

    const mark = document.createElement("span");
    mark.textContent = "✦";
    welcome.appendChild(mark);
  }

  // Shared top-bar profile dropdown.
  const profileTrigger = document.getElementById("profileMenuTrigger");
  const profileDropdown = document.getElementById("profileDropdown");

  if (profileTrigger && profileDropdown) {
    profileTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const isOpen = profileDropdown.classList.toggle("show");
      profileTrigger.setAttribute("aria-expanded", String(isOpen));
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".profile-menu")) {
        profileDropdown.classList.remove("show");
        profileTrigger.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        profileDropdown.classList.remove("show");
        profileTrigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Role visibility.
  document.querySelectorAll("[data-roles]").forEach((el) => {
    const roles = el.dataset.roles
      .split(",")
      .map((x) => x.trim().toUpperCase());

    el.hidden = !roles.includes(role);
  });

  // Check current page access.
  const page = location.pathname.split("/").pop() || "dashboard.html";

  const currentLink = [
    ...document.querySelectorAll(".sidebar-nav a[href]"),
  ].find(
    (link) => link.getAttribute("href").split("?")[0].split("/").pop() === page,
  );

  if (currentLink && currentLink.hidden) {
    location.replace(DASHBOARD);
    return;
  }

  // Sidebar active link.
  document.querySelectorAll(".sidebar-nav .nav-link").forEach((link) => {
    const path = link.getAttribute("href").split("?")[0].split("/").pop();
    link.classList.toggle("active", path === page);
  });

  const viewAll = document.getElementById("viewAllTickets");

  if (viewAll && role !== "EMPLOYEE") {
    viewAll.textContent =
      role === "ADMIN" ? "View all tickets →" : "View team tickets →";
    viewAll.href = "all-tickets.html";
  }

  // Logout functionality.
  document
    .querySelectorAll(".js-logout, .logout-button, .dropdown-logout")
    .forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();

        if (!confirm("Are you sure you want to logout?")) return;

        button.disabled = true;

        try {
          if (typeof logoutUser !== "function")
            throw new Error("Logout API helper unavailable.");

          await logoutUser();
          location.replace(LOGIN);
        } catch (error) {
          console.error("Logout failed:", error);
          alert(error.message || "Unable to logout. Please try again.");
          button.disabled = false;
        }
      });
    });

  // Sidebar collapse behavior.
  const sidebar = document.querySelector(".sidebar");
  const brand = document.querySelector(".brand-logo");

  if (sidebar && brand && !sidebar.querySelector(".sidebar-toggle-btn")) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sidebar-toggle-btn";
    toggle.textContent = "‹";
    toggle.setAttribute("aria-label", "Toggle Sidebar");

    toggle.style.cssText = `
      position:absolute;
      right:15px;
      top:36px;
      background:var(--surface-soft);
      border:1px solid var(--border);
      color:var(--text);
      border-radius:50%;
      width:24px;
      height:24px;
      display:grid;
      place-items:center;
      cursor:pointer;
      transition:all .3s ease;
      z-index:30;
      font-size:14px;
      font-weight:bold;
    `;

    sidebar.appendChild(toggle);

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      sidebar.classList.toggle("collapsed");

      const collapsed = sidebar.classList.contains("collapsed");
      toggle.textContent = collapsed ? "›" : "‹";
      toggle.style.right = collapsed ? "28px" : "15px";
      toggle.style.top = collapsed ? "80px" : "36px";
    });

    brand.addEventListener("click", (event) => {
      if (!sidebar.classList.contains("collapsed")) return;

      event.preventDefault();
      sidebar.classList.remove("collapsed");
      toggle.textContent = "‹";
      toggle.style.right = "15px";
      toggle.style.top = "36px";
    });
  }

  // Mobile sidebar behavior - centralized for every authenticated page.
  const menu = document.getElementById("menuToggle");
  const overlay = document.getElementById("sidebarOverlay");

  function closeMobileSidebar() {
    sidebar?.classList.remove("open");
    overlay?.classList.remove("show");
    menu?.setAttribute("aria-expanded", "false");
  }

  if (menu && sidebar && overlay) {
    menu.setAttribute("aria-expanded", "false");

    menu.addEventListener("click", (event) => {
      event.preventDefault();

      const isOpen = !sidebar.classList.contains("open");
      sidebar.classList.toggle("open", isOpen);
      overlay.classList.toggle("show", isOpen);
      menu.setAttribute("aria-expanded", String(isOpen));
    });

    overlay.addEventListener("click", closeMobileSidebar);

    sidebar.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.innerWidth <= 850) closeMobileSidebar();
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMobileSidebar();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 850) closeMobileSidebar();
    });
  }
});

/* Re-trigger bar animations when new bars are inserted. */
const barObserver = new MutationObserver((records) => {
  records.forEach((record) =>
    record.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const bars = [];

      if (node.matches?.(".bar-fill")) bars.push(node);

      node.querySelectorAll?.(".bar-fill").forEach((bar) => bars.push(bar));

      bars.forEach((bar) => {
        bar.style.animation = "none";
        void bar.offsetHeight;
        bar.style.animation =
          "cm-bar-grow 1s cubic-bezier(0.22, 0.61, 0.36, 1) both";
      });
    }),
  );
});

document.addEventListener("DOMContentLoaded", () => {
  const main = document.querySelector(".main-content");

  if (main) {
    barObserver.observe(main, { childList: true, subtree: true });
  }
});

/* Counter animation intentionally disabled for API-driven pages. */
