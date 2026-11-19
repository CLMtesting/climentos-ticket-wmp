/* Climentos WMP - live, session-authenticated Reports & Analytics */
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const statusMeta = [
    { key: "OPEN", label: "Open", color: "#f1a34e", legend: "legendOpen" },
    { key: "IN_PROGRESS", label: "In Progress", color: "#659eea", legend: "legendProgress" },
    { key: "ON_HOLD", label: "On Hold", color: "#e6c45d", legend: "legendHold" },
    { key: "RESOLVED", label: "Resolved", color: "#24b995", legend: "legendResolved" },
    { key: "CLOSED", label: "Closed", color: "#8b6cf0", legend: "legendClosed" },
    { key: "REJECTED", label: "Rejected", color: "#e66b78", legend: "legendRejected" },
  ];
  const priorityMeta = {
    URGENT: { label: "Urgent", color: "#e66b78" },
    HIGH: { label: "High", color: "#ef9b55" },
    MEDIUM: { label: "Medium", color: "#6999e8" },
    LOW: { label: "Low", color: "#25b58d" },
  };

  let reportData = null;
  let loading = false;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  function setMessage(message, isError = false) {
    const target = $("reportsMessage");
    if (!target) return;
    target.textContent = message || "";
    target.style.color = isError ? "var(--orange)" : "var(--muted)";
  }

  function populateDepartments(items, selectedValue) {
    const select = $("departmentFilter");
    if (!select) return;
    const current = selectedValue ?? select.value;
    select.replaceChildren(new Option("All departments", ""));
    (items || []).forEach((item) => {
      if (item.department_id === null) return;
      select.add(new Option(item.department_name, String(item.department_id)));
    });
    if ([...select.options].some((option) => option.value === String(current))) {
      select.value = String(current);
    } else {
      select.value = "";
    }
  }

  function renderStats(stats) {
    $("totalTickets").textContent = stats.total ?? 0;
    $("resolvedTickets").textContent = stats.resolved_total ?? 0;
    $("openTickets").textContent = stats.open_count ?? 0;
    $("resolutionRate").textContent = `${stats.resolution_rate ?? 0}%`;
    $("donutTotal").textContent = stats.total ?? 0;
  }

  function renderStatuses(statuses, total) {
    const countByStatus = Object.fromEntries(
      (statuses || []).map((item) => [String(item.status).toUpperCase(), Number(item.count) || 0]),
    );
    let offset = 0;
    const segments = [];
    statusMeta.forEach((item) => {
      const count = countByStatus[item.key] || 0;
      const percent = total ? (count / total) * 100 : 0;
      segments.push(`${item.color} ${offset}% ${offset + percent}%`);
      offset += percent;
      const legend = $(item.legend);
      if (legend) legend.textContent = `${count} (${Math.round(percent)}%)`;
    });
    $("statusDonut").style.background = total
      ? `conic-gradient(${segments.join(", ")})`
      : "conic-gradient(var(--surface-soft) 0 100%)";
  }

  function renderBars(containerId, items, getLabel, getValue, getColor) {
    const container = $(containerId);
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p class="report-empty">No records for this selection.</p>';
      return;
    }
    const max = Math.max(1, ...items.map(getValue));
    container.innerHTML = items.map((item) => {
      const value = getValue(item);
      const color = getColor ? getColor(item) : null;
      return `<div class="bar-row">
        <span class="bar-name" title="${escapeHtml(getLabel(item))}">${escapeHtml(getLabel(item))}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%;${color ? `background:${color};` : ""}"></div></div>
        <b class="bar-value">${value}</b>
      </div>`;
    }).join("");
  }

  function renderDepartments(items) {
    renderBars("departmentChart", items,
      (item) => item.department_name, (item) => Number(item.total) || 0);
    const body = $("departmentTableBody");
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="5">No department ticket records found.</td></tr>';
      return;
    }
    body.innerHTML = items.map((item) => {
      const total = Number(item.total) || 0;
      const resolved = Number(item.resolved) || 0;
      const pending = total - resolved;
      const rate = total ? Math.round((resolved / total) * 100) : 0;
      return `<tr>
        <td>${escapeHtml(item.department_name)}</td><td>${total}</td>
        <td>${resolved}</td><td>${pending}</td><td class="rate">${rate}%</td>
      </tr>`;
    }).join("");
  }

  function renderPriorities(items) {
    const normalized = (items || []).map((item) => ({
      ...item,
      priority: String(item.priority || "").toUpperCase(),
    }));
    // Show all supported priority levels, including zero-count levels.
    const rows = Object.keys(priorityMeta).map((key) => ({
      priority: key,
      count: Number(normalized.find((item) => item.priority === key)?.count || 0),
    }));
    renderBars("priorityList", rows,
      (item) => priorityMeta[item.priority].label,
      (item) => item.count,
      (item) => priorityMeta[item.priority].color);
  }

  function renderTrend(items) {
    const svg = $("trendChart");
    const axis = $("trendAxisLabels");
    if (!svg || !axis) return;
    if (!items.length) {
      svg.innerHTML = "";
      axis.textContent = "No activity in the selected period";
      return;
    }
    const points = items.slice(-10);
    const width = 700, left = 30, right = 675, top = 20, bottom = 205;
    const maxValue = Math.max(1, ...points.flatMap((item) => [
      Number(item.created) || 0, Number(item.resolved) || 0,
    ]));
    const x = (index) => points.length === 1 ? (left + right) / 2 :
      left + (index * (right - left)) / (points.length - 1);
    const y = (value) => bottom - ((Number(value) || 0) / maxValue) * (bottom - top);
    const linePoints = (key) => points.map((item, index) => `${x(index)},${y(item[key])}`).join(" ");
    const grid = [0, 1, 2, 3, 4].map((index) => {
      const yy = top + (index * (bottom - top)) / 4;
      return `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="var(--border)" stroke-dasharray="3 5"/>`;
    }).join("");
    svg.innerHTML = `${grid}
      <polyline points="${linePoints("created")}" fill="none" stroke="#8b6cf0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="${linePoints("resolved")}" fill="none" stroke="#24b995" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    const labels = [points[0], points[Math.floor((points.length - 1) / 3)],
      points[Math.floor(2 * (points.length - 1) / 3)], points[points.length - 1]]
      .filter((item, index, array) => array.findIndex((x) => x.label === item.label) === index);
    axis.replaceChildren(...labels.map((item) => {
      const span = document.createElement("span");
      span.textContent = item.label;
      return span;
    }));
  }

  function render(data) {
    reportData = data;
    renderStats(data.stats || {});
    renderStatuses(data.statuses || [], Number(data.stats?.total || 0));
    renderDepartments(data.departments || []);
    renderPriorities(data.priorities || []);
    renderTrend(data.trend || []);
    const scopeText = data.scope === "ORGANIZATION" ? "Organization data"
      : data.scope === "PERSONAL" ? "Your personal tickets" : "Your managed teams and direct reports";
    const periodText = $("periodFilter").selectedOptions[0]?.textContent || "Selected period";
    const stamp = new Date().toLocaleString();
    const updated = document.querySelector(".report-updated");
    if (updated) updated.textContent = `${scopeText} · Updated ${stamp}`;
    const chip = $("trendChip");
    if (chip) chip.textContent = periodText;
    setMessage(`${scopeText}. All figures are loaded from the database.`);
  }

  async function loadReports() {
    if (loading) return;
    loading = true;
    setMessage("Loading report data...");
    $("exportReport").disabled = true;
    try {
      const period = $("periodFilter").value;
      const departmentId = $("departmentFilter").value;
      const response = await getReportsSummary(period, departmentId);
      if (!response.success) throw new Error(response.message || "Unable to load reports.");
      const selected = departmentId;
      populateDepartments(response.department_options || [], selected);
      render(response);
    } catch (error) {
      console.error("Reports loading failed:", error);
      setMessage(error.message || "Unable to load reports. Please try again.", true);
      $("totalTickets").textContent = "—";
      $("resolvedTickets").textContent = "—";
      $("openTickets").textContent = "—";
      $("resolutionRate").textContent = "—";
      $("donutTotal").textContent = "—";
      $("departmentChart").innerHTML = "";
      $("priorityList").innerHTML = "";
      $("departmentTableBody").innerHTML = "";
      $("trendChart").innerHTML = "";
      $("exportReport").disabled = true;
    } finally {
      loading = false;
      if (reportData) $("exportReport").disabled = false;
    }
  }

  function exportCsv() {
    if (!reportData) return;
    const data = reportData;
    const rows = [
      ["Climentos Work Management Platform - Reports & Analytics"],
      ["Role", data.user?.role || ""],
      ["Scope", data.scope || ""],
      ["Period", $("periodFilter").selectedOptions[0]?.textContent || ""],
      ["Department", $("departmentFilter").selectedOptions[0]?.textContent || "All departments"],
      [],
      ["Metric", "Value"],
      ["Total tickets", data.stats.total],
      ["Open", data.stats.open_count],
      ["In Progress", data.stats.in_progress_count],
      ["On Hold", data.stats.on_hold_count],
      ["Resolved", data.stats.resolved_count],
      ["Closed", data.stats.closed_count],
      ["Rejected", data.stats.rejected_count],
      ["Resolution rate", `${data.stats.resolution_rate}%`],
      [],
      ["Department", "Total", "Resolved/Closed", "Pending", "Resolution rate"],
      ...(data.departments || []).map((item) => {
        const total = Number(item.total) || 0;
        const resolved = Number(item.resolved) || 0;
        return [item.department_name, total, resolved, total - resolved,
          `${total ? Math.round((resolved / total) * 100) : 0}%`];
      }),
      [],
      ["Priority", "Tickets"],
      ...(data.priorities || []).map((item) => [item.priority, item.count]),
      [],
      ["Trend bucket", "Created", "Resolved"],
      ...(data.trend || []).map((item) => [item.label, item.created, item.resolved]),
    ];
    const csv = rows.map((row) => row.map((value) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `climentos-reports-${String(data.user?.role || "user").toLowerCase()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  $("periodFilter")?.addEventListener("change", loadReports);
  $("departmentFilter")?.addEventListener("change", loadReports);
  $("exportReport")?.addEventListener("click", exportCsv);
  $("globalSearch")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const query = event.currentTarget.value.trim().toLowerCase();
      if (!query) return;
      const row = [...document.querySelectorAll("#departmentTableBody tr")]
        .find((item) => item.textContent.toLowerCase().includes(query));
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
      else setMessage("No matching department in the current report.");
    }
  });

  loadReports();
});
