/* CLIMENTOS WMP - REAL ROLE-SCOPED ALL TICKETS */
document.addEventListener("DOMContentLoaded", async () => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const body = $("allTicketsBody");
  const modal = $("ticketModal");
  const search = $("ticketSearch");
  const statusFilter = $("statusFilter");
  const priorityFilter = $("priorityFilter");
  const departmentFilter = $("departmentFilter");
  const sortFilter = $("sortFilter");
  const pageSize = 8;
  let tickets = [];
  let page = 1;
  let activeTicket = null;
  let currentRole = "";
  let assignmentOptions = { employees: [], teams: [] };

  if (!body || typeof getAllTickets !== "function") {
    console.error("All Tickets requires api.js before all-tickets.js.");
    return;
  }

  const norm = (v) =>
    String(v ?? "")
      .trim()
      .toUpperCase();
  const titleCase = (v) =>
    String(v || "—")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const dateText = (v) => {
    if (!v) return "—";
    const d = new Date(String(v).replace(" ", "T"));
    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
  };
  const safe = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

  function updateStats(stats = {}) {
    $("totalCount").textContent = stats.total ?? tickets.length;
    $("openCount").textContent = stats.open_count ?? 0;
    $("progressCount").textContent = stats.in_progress_count ?? 0;
    $("resolvedCount").textContent =
      Number(stats.resolved_count || 0) + Number(stats.closed_count || 0);
  }

  function filtered() {
    const q = (search?.value || "").trim().toLowerCase();
    const s = norm(statusFilter?.value || "").replaceAll(" ", "_");
    const p = norm(priorityFilter?.value || "");
    const d = (departmentFilter?.value || "").toLowerCase();
    return tickets
      .filter((t) => {
        const hay = [
          t.ticket_number,
          t.title,
          t.created_by_name,
          t.created_by_email,
          t.department_name,
          t.team_name,
          t.assigned_to_name,
          t.category,
        ]
          .join(" ")
          .toLowerCase();
        return (
          (!q || hay.includes(q)) &&
          (!s || norm(t.status) === s) &&
          (!p || norm(t.priority) === p) &&
          (!d || String(t.department_name || "").toLowerCase() === d)
        );
      })
      .sort((a, b) => {
        const at = new Date(a.created_at || 0).getTime();
        const bt = new Date(b.created_at || 0).getTime();
        return sortFilter?.value === "oldest" ? at - bt : bt - at;
      });
  }

  function populateAssignmentOptions(ticket) {
    const select = $("modalAssignmentSelect");
    if (!select) return;
    select.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Not assigned";
    select.appendChild(none);

    if (assignmentOptions.employees.length) {
      const employeeGroup = document.createElement("optgroup");
      employeeGroup.label = "Employees";
      assignmentOptions.employees.forEach((employee) => {
        const option = document.createElement("option");
        option.value = `user:${employee.id}`;
        option.textContent = employee.full_name;
        employeeGroup.appendChild(option);
      });
      select.appendChild(employeeGroup);
    }
    if (assignmentOptions.teams.length) {
      const teamGroup = document.createElement("optgroup");
      teamGroup.label = "Teams";
      assignmentOptions.teams.forEach((team) => {
        const option = document.createElement("option");
        option.value = `team:${team.id}`;
        option.textContent = team.team_name;
        teamGroup.appendChild(option);
      });
      select.appendChild(teamGroup);
    }
    select.value = ticket.assigned_to
      ? `user:${ticket.assigned_to}`
      : ticket.team_id
        ? `team:${ticket.team_id}`
        : "";
  }

  function openDetails(t) {
    activeTicket = t;
    $("modalTicketId").textContent = t.ticket_number || `#${t.id}`;
    $("modalTicketTitle").textContent = t.title || "—";
    $("modalTicketDescription").textContent = t.description || "—";
    $("modalEmployee").textContent = t.created_by_name || "—";
    $("modalDepartment").textContent = t.department_name || "—";
    $("modalCategory").textContent = t.category || "—";
    $("modalPriority").textContent = titleCase(t.priority);
    $("modalAssignedTo").textContent =
      t.assigned_to_name || t.team_name || "Not assigned";
    $("modalDate").textContent = dateText(t.created_at);
    $("assignmentMessage").textContent = "Choose an eligible employee or team.";
    $("statusMessage").textContent =
      "Status changes are saved to the database.";
    populateAssignmentOptions(t);
    $("modalStatusSelect").value = norm(t.status).replaceAll(" ", "_");
    $("assignmentEditor").hidden =
      currentRole !== "MANAGER" && currentRole !== "ADMIN";
    $("statusEditor").hidden =
      currentRole !== "MANAGER" && currentRole !== "ADMIN";
    modal?.classList.add("show");
    modal?.setAttribute("aria-hidden", "false");
  }
  function closeDetails() {
    modal?.classList.remove("show");
    modal?.setAttribute("aria-hidden", "true");
  }

  function render() {
    const items = filtered();
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    page = Math.min(page, pages);
    const start = (page - 1) * pageSize;
    const current = items.slice(start, start + pageSize);
    body.replaceChildren();

    current.forEach((t) => {
      const tr = document.createElement("tr");
      const values = [
        t.ticket_number || `#${t.id}`,
        t.title || "—",
        t.created_by_name || "—",
        t.department_name || "—",
        titleCase(t.priority),
        titleCase(t.status).replace("In_Progress", "In Progress"),
        t.assigned_to_name || t.team_name || "Not assigned",
        dateText(t.created_at),
      ];
      values.forEach((value, index) => {
        const td = document.createElement("td");
        td.textContent = value;
        if (index === 0) td.className = "all-ticket-id";
        tr.appendChild(td);
      });
      const action = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "all-view-button";
      button.textContent = "View";
      button.addEventListener("click", () => openDetails(t));
      action.appendChild(button);
      tr.appendChild(action);
      body.appendChild(tr);
    });

    $("resultCount").textContent =
      `${items.length} ticket${items.length === 1 ? "" : "s"}`;
    $("emptyTickets").hidden = items.length > 0;
    $("paginationInfo").textContent = items.length
      ? `Showing ${start + 1}-${start + current.length} of ${items.length} tickets`
      : "Showing 0 tickets";
    $("pageNumber").textContent = `${page} / ${pages}`;
    $("previousPage").disabled = page <= 1;
    $("nextPage").disabled = page >= pages;
  }

  function reset() {
    page = 1;
    render();
  }
  [search, statusFilter, priorityFilter, departmentFilter, sortFilter].forEach(
    (el) => {
      el?.addEventListener("input", reset);
      el?.addEventListener("change", reset);
    },
  );
  $("clearFilters")?.addEventListener("click", () => {
    [search, statusFilter, priorityFilter, departmentFilter].forEach((el) => {
      if (el) el.value = "";
    });
    if (sortFilter) sortFilter.value = "newest";
    reset();
  });
  $("emptyClearFilters")?.addEventListener("click", () =>
    $("clearFilters")?.click(),
  );
  $("previousPage")?.addEventListener("click", () => {
    if (page > 1) {
      page--;
      render();
    }
  });
  $("nextPage")?.addEventListener("click", () => {
    page++;
    render();
  });
  $("closeTicketModal")?.addEventListener("click", closeDetails);
  $("closeModalButton")?.addEventListener("click", closeDetails);
  $("saveAssignmentButton")?.addEventListener("click", async () => {
    if (!activeTicket) return;
    const button = $("saveAssignmentButton");
    const message = $("assignmentMessage");
    const selected = $("modalAssignmentSelect").value;
    const assignment = { assigned_to: null, team_id: null };
    if (selected.startsWith("user:"))
      assignment.assigned_to = Number(selected.slice(5));
    if (selected.startsWith("team:"))
      assignment.team_id = Number(selected.slice(5));
    button.disabled = true;
    message.textContent = "Saving assignment...";
    try {
      await updateTicketAssignment(activeTicket.id, assignment);
      message.textContent = "Assignment saved successfully.";
      await reloadTickets();
      const updated = tickets.find(
        (item) => Number(item.id) === Number(activeTicket.id),
      );
      if (updated) openDetails(updated);
    } catch (error) {
      message.textContent = error.message || "Unable to save assignment.";
    } finally {
      button.disabled = false;
    }
  });

  $("saveStatusButton")?.addEventListener("click", async () => {
    if (!activeTicket) return;
    const button = $("saveStatusButton");
    const message = $("statusMessage");
    const status = $("modalStatusSelect").value;
    button.disabled = true;
    message.textContent = "Updating status...";
    try {
      await updateTicketStatus(activeTicket.id, status);
      message.textContent = "Ticket status updated successfully.";
      await reloadTickets();
      const updated = tickets.find(
        (item) => Number(item.id) === Number(activeTicket.id),
      );
      if (updated) openDetails(updated);
    } catch (error) {
      message.textContent = error.message || "Unable to update ticket status.";
    } finally {
      button.disabled = false;
    }
  });
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeDetails();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetails();
  });

  async function reloadTickets() {
    const result = await getAllTickets();
    tickets = Array.isArray(result.tickets) ? result.tickets : [];
    updateStats(result.stats);
    render();
  }

  try {
    const session = await getCurrentUser();
    const role = norm(session.user?.role);
    currentRole = role;
    if (!["MANAGER", "ADMIN"].includes(role)) {
      location.replace("dashboard.html");
      return;
    }
    $("allTicketsPageTitle").innerHTML =
      role === "MANAGER"
        ? "Team Tickets <span>✦</span>"
        : "All Tickets <span>✦</span>";
    $("allTicketsPageSubtitle").textContent =
      role === "MANAGER"
        ? "Review tickets raised by your direct reports and managed teams."
        : "View and review tickets submitted across the organization.";
    $("allTicketsPanelTitle").textContent =
      role === "MANAGER" ? "Team Tickets" : "Organization Tickets";
    $("allTicketsPanelSubtitle").textContent =
      role === "MANAGER"
        ? "Tickets from direct reports, team members and managed teams."
        : "Browse and review all submitted tickets.";
    assignmentOptions = await getTicketAssignmentOptions();
    await reloadTickets();
  } catch (error) {
    console.error("All Tickets load failed:", error);
    body.innerHTML = `<tr><td colspan="9">${safe(error.message || "Unable to load tickets.")}</td></tr>`;
    $("resultCount").textContent = "Unable to load";
  }
});
