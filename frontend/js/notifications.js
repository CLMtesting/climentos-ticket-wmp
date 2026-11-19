/* Climentos WMP - database-backed notifications */
document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);
  const listEl = $("notificationList");
  const searchEl = $("notificationSearch");
  const globalSearch = $("globalSearch");
  let notifications = [];
  let visibleLimit = 5;

  const escapeHTML = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  const typeName = (value) => {
    const type = String(value || "GENERAL").toUpperCase();
    if (type.includes("ASSIGN")) return "assignment";
    if (type.includes("SYSTEM")) return "system";
    return "ticket";
  };
  const relativeTime = (value) => {
    if (!value) return "";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return String(value);
    const seconds = Math.max(
      0,
      Math.floor((Date.now() - date.getTime()) / 1000),
    );
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 172800) return "Yesterday";
    return date.toLocaleDateString();
  };

  function filtered() {
    const q = (searchEl?.value || "").trim().toLowerCase();
    const type = $("notificationTypeFilter")?.value || "";
    const read = $("notificationReadFilter")?.value || "";
    return notifications.filter((item) => {
      const haystack =
        `${item.title} ${item.message} ${item.ticket_number || ""}`.toLowerCase();
      const isRead = Boolean(item.is_read);
      return (
        (!q || haystack.includes(q)) &&
        (!type || typeName(item.notification_type) === type) &&
        (!read || (read === "unread" ? !isRead : isRead))
      );
    });
  }

  function render() {
    const rows = filtered();
    const unread = notifications.filter((n) => !n.is_read).length;
    const today = notifications.filter((n) => {
      if (!n.created_at) return false;
      const d = new Date(String(n.created_at).replace(" ", "T"));
      return (
        !Number.isNaN(d.getTime()) &&
        d.toDateString() === new Date().toDateString()
      );
    }).length;
    $("totalNotifications").textContent = Number(
      $("totalNotifications").dataset.total || notifications.length,
    );
    $("unreadNotifications").textContent = unread;
    $("todayNotifications").textContent = today;
    const badge = $("sidebarUnreadCount");
    if (badge) {
      badge.textContent = unread;
      badge.hidden = unread === 0;
    }
    $("visibleNotificationCount").textContent =
      `${rows.length} update${rows.length === 1 ? "" : "s"}`;
    $("notificationResultsLabel").textContent =
      `Showing ${Math.min(visibleLimit, rows.length)} of ${rows.length} notifications`;
    $("notificationEmpty").hidden = rows.length > 0;
    listEl.hidden = rows.length === 0;
    $("loadMoreNotifications").hidden = rows.length <= visibleLimit;
    listEl.innerHTML = rows
      .slice(0, visibleLimit)
      .map((item) => {
        const type = typeName(item.notification_type);
        const read = Boolean(item.is_read);
        return `<article class="notification-item ${read ? "" : "unread"}" data-id="${Number(item.id)}">
        <div class="notification-symbol ${type}">${type === "assignment" ? "♧" : type === "system" ? "⚙" : "▤"}</div>
        <div class="notification-copy"><h3>${escapeHTML(item.title)} ${read ? "" : '<span class="unread-dot" aria-label="Unread"></span>'}</h3>
        <p>${escapeHTML(item.message)}</p><div class="notification-meta"><span>${escapeHTML(relativeTime(item.created_at))}</span>
        ${item.ticket_number ? `<span class="notification-ticket">${escapeHTML(item.ticket_number)}</span>` : ""}<span>${type[0].toUpperCase() + type.slice(1)}</span></div></div>
        <div class="notification-actions"><button class="notification-action" data-action="toggle" data-id="${Number(item.id)}">${read ? "Mark unread" : "Mark read"}</button>
        <button class="notification-action" data-action="delete" data-id="${Number(item.id)}">Dismiss</button></div></article>`;
      })
      .join("");
  }

  async function load() {
    listEl.innerHTML =
      '<p class="notification-loading">Loading notifications...</p>';
    try {
      const response = await getNotifications(200);
      notifications = Array.isArray(response.notifications)
        ? response.notifications
        : [];
      $("totalNotifications").dataset.total = String(
        response.counts?.total ?? notifications.length,
      );
      $("totalNotifications").textContent =
        response.counts?.total ?? notifications.length;
      $("unreadNotifications").textContent = response.counts?.unread ?? 0;
      $("todayNotifications").textContent = response.counts?.today ?? 0;
      render();
      if (typeof window.refreshNotificationBadge === "function") {
        window.refreshNotificationBadge();
      }
    } catch (error) {
      console.error("Notifications API failed:", error);
      listEl.innerHTML = `<p class="notification-error">${escapeHTML(error.message || "Unable to load notifications.")}</p>`;
      $("notificationEmpty").hidden = true;
    }
  }

  listEl.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const item = notifications.find((n) => Number(n.id) === id);
    if (!item) return;
    button.disabled = true;
    try {
      if (button.dataset.action === "toggle") {
        await setNotificationRead(id, !Boolean(item.is_read));
      } else if (button.dataset.action === "delete") {
        await dismissNotification(id);
      }
      await load();
    } catch (error) {
      alert(error.message || "Unable to update notification.");
      button.disabled = false;
    }
  });

  $("markAllReadButton").addEventListener("click", async () => {
    try {
      await markAllNotificationsRead();
      await load();
    } catch (error) {
      alert(error.message || "Unable to mark notifications as read.");
    }
  });
  function clearFilters() {
    searchEl.value = "";
    globalSearch.value = "";
    $("notificationTypeFilter").value = "";
    $("notificationReadFilter").value = "";
    visibleLimit = 5;
    render();
  }
  $("clearNotificationFilters").addEventListener("click", clearFilters);
  $("resetNotificationFilters").addEventListener("click", clearFilters);
  [searchEl, $("notificationTypeFilter"), $("notificationReadFilter")].forEach(
    (el) =>
      el.addEventListener(el === searchEl ? "input" : "change", () => {
        visibleLimit = 5;
        render();
      }),
  );
  globalSearch.addEventListener("input", () => {
    searchEl.value = globalSearch.value;
    visibleLimit = 5;
    render();
  });
  $("loadMoreNotifications").addEventListener("click", () => {
    visibleLimit += 5;
    render();
  });
  // Topbar notification navigation and unread badge are managed by global.js.
  await load();
});
