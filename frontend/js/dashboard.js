/* CLIMENTOS WMP - LIVE ROLE-AWARE DASHBOARD */
document.addEventListener("DOMContentLoaded", async () => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const recentBody = $("recentTicketsBody");
  const periodSelect = $("chartPeriod");
  let dashboardData = null;

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>\"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  const nice = (value) =>
    String(value || "—")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const fmtDate = (value) => {
    if (!value) return "—";
    const date = new Date(String(value).replace(" ", "T"));
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };
  const statusClass = (s) =>
    ({
      OPEN: "open",
      IN_PROGRESS: "progress",
      RESOLVED: "resolved",
      CLOSED: "resolved",
      ON_HOLD: "hold",
      REJECTED: "rejected",
    })[s] || "open";
  const priorityClass = (p) =>
    ({ LOW: "low", MEDIUM: "medium", HIGH: "high", URGENT: "high" })[p] ||
    "medium";

  // Topbar notification navigation and unread badge are managed by global.js.
  $("currentDate").textContent = new Date()
    .toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .toUpperCase();

  function setMetric(key, label, value) {
    const labelEl = document.querySelector(`[data-metric="${key}"]`);
    const valueEl = document.querySelector(`[data-value="${key}"]`);
    if (labelEl) labelEl.textContent = label;
    if (valueEl)
      valueEl.textContent = Number(value || 0).toLocaleString("en-IN");
  }
  function renderRecent(rows) {
    if (!recentBody) return;
    recentBody.replaceChildren();
    if (!rows.length) {
      recentBody.innerHTML =
        '<tr><td colspan="6" class="dashboard-empty">No tickets found for this account.</td></tr>';
      return;
    }
    rows.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="ticket-id">#${esc(t.ticket_number)}</td><td class="ticket-title">${esc(t.title)}</td><td>${esc(t.category || t.department_name || "—")}</td><td><span class="priority ${priorityClass(t.priority)}">${esc(nice(t.priority))}</span></td><td><span class="status ${statusClass(t.status)}">${esc(nice(t.status).replace("In_Progress", "In Progress"))}</span></td><td>${esc(fmtDate(t.created_at))}</td>`;
      recentBody.appendChild(tr);
    });
  }
  function renderDistribution(items, total) {
    const donut = document.querySelector(".donut-chart");
    const center = document.querySelector(".donut-center strong");
    const list = document.querySelector(".distribution-list");
    if (center) center.textContent = Number(total || 0).toLocaleString("en-IN");
    const colors = {
      OPEN: "#8a68f2",
      IN_PROGRESS: "#f0a74e",
      ON_HOLD: "#7da8ef",
      RESOLVED: "#4ac8a4",
      CLOSED: "#278c70",
      REJECTED: "#dc6b75",
    };
    let cursor = 0;
    const segments = [];
    (items || []).forEach((item) => {
      const pct = total ? (Number(item.count || 0) / total) * 100 : 0;
      if (pct > 0) {
        segments.push(
          `${colors[item.status] || "#9ca3af"} ${cursor}% ${cursor + pct}%`,
        );
        cursor += pct;
      }
    });
    if (donut)
      donut.style.background = total
        ? `conic-gradient(${segments.join(",")})`
        : "conic-gradient(#e5e7eb 0% 100%)";
    if (list) {
      list.replaceChildren();
      (items || [])
        .filter((x) => Number(x.count) > 0)
        .forEach((item) => {
          const row = document.createElement("div");
          const dot = document.createElement("i");
          dot.className = `distribution-dot ${statusClass(item.status)}`;
          dot.style.background = colors[item.status] || "#9ca3af";
          const label = document.createElement("span");
          label.textContent = item.label;
          const count = document.createElement("strong");
          count.textContent = Number(item.count).toLocaleString("en-IN");
          row.append(dot, label, count);
          list.appendChild(row);
        });
      if (!list.children.length) list.textContent = "No ticket data available.";
    }
  }
  function renderActivity(activity) {
    const svg = document.querySelector(".activity-chart");
    const xAxis = document.querySelector(".chart-x-axis");
    const yAxis = document.querySelector(".chart-y-axis");
    if (!svg) return;
    const labels = activity?.labels || [];
    const raised = activity?.raised || [];
    const resolved = activity?.resolved || [];
    const max = Math.max(1, ...raised, ...resolved);
    const makePath = (values) => {
      if (!values.length) return "";
      const width = 600,
        height = 190;
      return values
        .map(
          (v, i) =>
            `${i ? "L" : "M"}${values.length === 1 ? width / 2 : (i / (values.length - 1)) * width} ${height - (Number(v) / max) * (height - 12)}`,
        )
        .join(" ");
    };
    svg.innerHTML = `<path class="raised-line" d="${makePath(raised)}"></path><path class="resolved-line" d="${makePath(resolved)}"></path>`;
    if (xAxis) {
      xAxis.replaceChildren();
      labels.forEach((label, i) => {
        if (
          labels.length <= 7 ||
          i % Math.ceil(labels.length / 7) === 0 ||
          i === labels.length - 1
        ) {
          const span = document.createElement("span");
          span.textContent = label;
          xAxis.appendChild(span);
        }
      });
    }
    if (yAxis) {
      yAxis.replaceChildren();
      [
        max,
        Math.round(max * 0.75),
        Math.round(max * 0.5),
        Math.round(max * 0.25),
        0,
      ].forEach((v) => {
        const span = document.createElement("span");
        span.textContent = v;
        yAxis.appendChild(span);
      });
    }
  }
  function render(data) {
    dashboardData = data;
    const role = String((data.user || {}).role || "EMPLOYEE").toUpperCase();
    // global.js supplies the canonical authenticated user identity and greeting.
    const desc = $("welcomeDescription");
    if (desc)
      desc.textContent =
        role === "EMPLOYEE"
          ? "Here is an overview of your personal tickets and activity."
          : role === "MANAGER"
            ? "Monitor tickets assigned to the teams you manage."
            : "Monitor company-wide ticket activity and operations.";
    const raise = $("raiseTicketButton");
    if (raise) raise.hidden = role === "ADMIN";
    const view = $("viewAllTickets");
    if (view) {
      view.href = role === "EMPLOYEE" ? "my-tickets.html" : "all-tickets.html";
      view.textContent =
        role === "EMPLOYEE" ? "View my tickets →" : "View all tickets →";
    }
    const s = data.stats || {};
    setMetric(
      "total",
      role === "EMPLOYEE"
        ? "My Tickets"
        : role === "MANAGER"
          ? "Team Tickets"
          : "Total Tickets",
      s.total,
    );
    setMetric("open", "Open", s.open_count);
    setMetric("progress", "In Progress", s.in_progress_count);
    setMetric(
      "resolved",
      "Resolved",
      Number(s.resolved_count || 0) + Number(s.closed_count || 0),
    );
    renderDistribution(data.distribution, s.total);
    renderActivity(data.activity);
    renderRecent(data.recent_tickets || []);
  }
  async function loadDashboard(period) {
    if (recentBody)
      recentBody.innerHTML =
        '<tr><td colspan="6">Loading live ticket data...</td></tr>';
    try {
      const response = await getDashboardSummary(period);
      if (!response.success)
        throw new Error(response.message || "Dashboard request failed.");
      render(response);
    } catch (error) {
      console.error("Dashboard API failed:", error);
      if (recentBody)
        recentBody.innerHTML = `<tr><td colspan="6">${esc(error.message || "Unable to load dashboard data.")}</td></tr>`;
      ["total", "open", "progress", "resolved"].forEach((k) =>
        setMetric(
          k,
          document.querySelector(`[data-metric="${k}"]`)?.textContent || k,
          "—",
        ),
      );
    }
  }
  periodSelect?.addEventListener("change", () =>
    loadDashboard(periodSelect.value),
  );
  $("dashboardSearch")?.addEventListener("input", () => {
    const q = $("dashboardSearch").value.trim().toLowerCase();
    recentBody
      ?.querySelectorAll("tr")
      .forEach(
        (row) =>
          (row.style.display = row.textContent.toLowerCase().includes(q)
            ? ""
            : "none"),
      );
  });
  document.addEventListener("keydown", (e) => {
    // global.js closes the shared profile dropdown on Escape.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("dashboardSearch")?.focus();
    }
  });
  if (typeof getDashboardSummary !== "function") {
    if (recentBody)
      recentBody.innerHTML =
        '<tr><td colspan="6">Dashboard API helper is missing. Check api.js loading order.</td></tr>';
    return;
  }
  await loadDashboard(periodSelect?.value || "month");
});
