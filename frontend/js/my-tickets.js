/* =========================================================
   CLIMENTOS WMP - MY TICKETS / EMPLOYEE WORKFLOW
   Real Flask + MySQL integration. No demo ticket data.
========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ticketBody = $("myTicketsBody");
  const ticketModal = $("ticketModal");
  const rowsPerPage = 5;
  let tickets = [];
  let currentPage = 1;
  let currentView = "ALL";
  let currentTicket = null;
  let currentUser = null;

  const STATUS_LABELS = {
    OPEN: "Open",
    IN_PROGRESS: "In Progress",
    ON_HOLD: "On Hold",
    RESOLVED: "Resolved",
    CLOSED: "Closed",
    REJECTED: "Rejected",
  };
  const PRIORITY_LABELS = {
    LOW: "Low",
    MEDIUM: "Medium",
    HIGH: "High",
    URGENT: "Urgent",
  };
  const normalize = (value) =>
    String(value ?? "")
      .trim()
      .toUpperCase();
  const statusLabel = (value) =>
    STATUS_LABELS[normalize(value)] || value || "—";
  const priorityLabel = (value) =>
    PRIORITY_LABELS[normalize(value)] || value || "—";
  const escapeText = (value) => String(value ?? "");

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(String(value).replace(" ", "T"));
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  }
  function statusClass(value) {
    return (
      {
        OPEN: "status-open",
        IN_PROGRESS: "status-in-progress",
        ON_HOLD: "status-on-hold",
        RESOLVED: "status-resolved",
        CLOSED: "status-closed",
        REJECTED: "status-rejected",
      }[normalize(value)] || ""
    );
  }
  function priorityClass(value) {
    return (
      {
        LOW: "priority-low",
        MEDIUM: "priority-medium",
        HIGH: "priority-high",
        URGENT: "priority-critical",
      }[normalize(value)] || ""
    );
  }
  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value == null || value === "" ? "—" : value;
  }

  function visibleTickets() {
    const query = ($("ticketSearch")?.value || "").trim().toLowerCase();
    const status = normalize($("statusFilter")?.value || "");
    const priority = normalize($("priorityFilter")?.value || "");
    const category = $("categoryFilter")?.value || "";
    return tickets
      .filter((ticket) => {
        const relationship = normalize(ticket.ticket_relationship || "CREATED");
        const viewMatch =
          currentView === "ALL" ||
          (currentView === "CREATED" &&
            ["CREATED", "BOTH"].includes(relationship)) ||
          (currentView === "ASSIGNED" &&
            ["ASSIGNED", "BOTH"].includes(relationship));
        const haystack = [
          ticket.ticket_number,
          ticket.title,
          ticket.description,
          ticket.category,
          ticket.department_name,
          ticket.assigned_to_name,
          ticket.team_name,
        ]
          .join(" ")
          .toLowerCase();
        return (
          viewMatch &&
          (!query || haystack.includes(query)) &&
          (!status || normalize(ticket.status) === status) &&
          (!priority || normalize(ticket.priority) === priority) &&
          (!category || String(ticket.category || "") === category)
        );
      })
      .sort((a, b) => {
        const first = new Date(a.created_at || 0).getTime();
        const second = new Date(b.created_at || 0).getTime();
        return $("sortFilter")?.value === "oldest"
          ? first - second
          : second - first;
      });
  }

  function updateStatistics() {
    const list =
      currentView === "CREATED"
        ? tickets.filter((t) =>
            ["CREATED", "BOTH"].includes(normalize(t.ticket_relationship)),
          )
        : currentView === "ASSIGNED"
          ? tickets.filter((t) =>
              ["ASSIGNED", "BOTH"].includes(normalize(t.ticket_relationship)),
            )
          : tickets;
    $("totalCount").textContent = list.length;
    $("openCount").textContent = list.filter(
      (t) => normalize(t.status) === "OPEN",
    ).length;
    $("progressCount").textContent = list.filter(
      (t) => normalize(t.status) === "IN_PROGRESS",
    ).length;
    $("resolvedCount").textContent = list.filter((t) =>
      ["RESOLVED", "CLOSED"].includes(normalize(t.status)),
    ).length;
  }

  function renderTickets() {
    const filtered = visibleTickets();
    const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * rowsPerPage;
    const pageTickets = filtered.slice(start, start + rowsPerPage);
    ticketBody.replaceChildren();
    $("resultCount").textContent =
      `${filtered.length} ticket${filtered.length === 1 ? "" : "s"}`;
    $("emptyTickets").hidden = filtered.length > 0;
    $("paginationInfo").textContent = filtered.length
      ? `Showing ${start + 1}-${start + pageTickets.length} of ${filtered.length} tickets`
      : "Showing 0 tickets";
    $("pageNumber").textContent = `${currentPage} / ${totalPages}`;
    $("previousPage").disabled = currentPage <= 1;
    $("nextPage").disabled = currentPage >= totalPages;

    pageTickets.forEach((ticket) => {
      const row = document.createElement("tr");
      const values = [
        ticket.ticket_number || `#${ticket.id}`,
        ticket.title || "—",
        ticket.category || "—",
      ];
      values.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 0) cell.className = "table-ticket-id";
        if (index === 1) cell.className = "table-ticket-title";
        row.appendChild(cell);
      });
      const priorityCell = document.createElement("td");
      const priorityBadge = document.createElement("span");
      priorityBadge.className = `priority-badge ${priorityClass(ticket.priority)}`;
      priorityBadge.textContent = priorityLabel(ticket.priority);
      priorityCell.appendChild(priorityBadge);
      const statusCell = document.createElement("td");
      const statusBadge = document.createElement("span");
      statusBadge.className = `status-badge ${statusClass(ticket.status)}`;
      statusBadge.textContent = statusLabel(ticket.status);
      statusCell.appendChild(statusBadge);
      const dateCell = document.createElement("td");
      dateCell.textContent = formatDate(ticket.created_at);
      const actionCell = document.createElement("td");
      if (
        ["ASSIGNED", "BOTH"].includes(normalize(ticket.ticket_relationship))
      ) {
        const assignedTag = document.createElement("span");
        assignedTag.className = "ticket-assigned-tag";
        assignedTag.textContent = "Assigned";
        actionCell.appendChild(assignedTag);
      }
      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = "view-ticket-button";
      viewButton.textContent = "View";
      viewButton.addEventListener("click", () => openTicketDetails(ticket));
      actionCell.appendChild(viewButton);
      row.append(priorityCell, statusCell, dateCell, actionCell);
      ticketBody.appendChild(row);
    });
  }

  function appendComment(comment) {
    const item = document.createElement("article");
    item.className = "ticket-comment-item";
    const header = document.createElement("div");
    header.className = "ticket-comment-header";
    const author = document.createElement("strong");
    author.textContent = escapeText(comment.author_name || "User");
    const date = document.createElement("time");
    date.textContent = formatDate(comment.created_at);
    header.append(author, date);
    const body = document.createElement("p");
    body.textContent = escapeText(comment.comment_text);
    item.append(header, body);
    $("ticketCommentsList").appendChild(item);
  }

  function renderTicketDetails(data) {
    const ticket = data.ticket;
    setText("modalTicketId", ticket.ticket_number);
    setText("modalTicketTitle", ticket.title);
    setText("modalTicketDescription", ticket.description);
    setText("modalCategory", ticket.category || "—");
    setText("modalPriority", priorityLabel(ticket.priority));
    setText("modalStatus", statusLabel(ticket.status));
    setText("modalDate", formatDate(ticket.created_at));
    setText("modalDepartment", ticket.department_name || "—");
    setText(
      "modalAssignedTo",
      ticket.assigned_to_name || ticket.team_name || "Not assigned",
    );

    const commentsList = $("ticketCommentsList");
    commentsList.replaceChildren();
    if (data.comments?.length) data.comments.forEach(appendComment);
    else {
      const empty = document.createElement("p");
      empty.className = "ticket-muted";
      empty.textContent = "No work updates yet.";
      commentsList.appendChild(empty);
    }

    const attachments = data.attachments || [];
    $("ticketAttachmentsSection").hidden = attachments.length === 0;
    const attachmentList = $("ticketAttachmentsList");
    attachmentList.replaceChildren();
    attachments.forEach((file) => {
      const link = document.createElement("a");
      link.href = `/api/tickets/${ticket.id}/attachments/${file.id}`;
      link.textContent = `${file.original_filename} (${Math.ceil(Number(file.file_size || 0) / 1024)} KB)`;
      link.className = "ticket-attachment-link";
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
      attachmentList.appendChild(link);
    });

    const relationship = normalize(currentTicket?.ticket_relationship);
    const isAssigned = ["ASSIGNED", "BOTH"].includes(relationship);
    const canEmployeeWork =
      normalize(currentUser?.role) === "EMPLOYEE" && isAssigned;
    $("employeeWorkActions").hidden = !canEmployeeWork;
    $("ticketCommentForm").hidden = !(
      canEmployeeWork ||
      relationship === "CREATED" ||
      normalize(currentUser?.role) !== "EMPLOYEE"
    );
    const status = normalize(ticket.status);
    const completed = ["RESOLVED", "CLOSED", "REJECTED"].includes(status);
    $("startWorkButton").hidden = completed || status === "IN_PROGRESS";
    $("startWorkButton").disabled = completed || status === "IN_PROGRESS";
    $("ticketResolutionForm").hidden = completed || status !== "IN_PROGRESS";
    $("employeeWorkMessage").textContent =
      status === "IN_PROGRESS"
        ? "You are currently working on this ticket. Submit a resolution when the issue is fixed."
        : "Start work when you begin investigating this issue. The resolution form becomes available after work starts.";
    $("ticketWorkMessage").textContent = "";
  }

  async function openTicketDetails(ticket) {
    currentTicket = ticket;
    ticketModal?.classList.add("show");
    document.body.style.overflow = "hidden";
    $("ticketCommentsList").textContent = "Loading updates...";
    try {
      const data = await getTicketDetails(ticket.id);
      renderTicketDetails(data);
    } catch (error) {
      $("ticketCommentsList").textContent =
        error.message || "Unable to load ticket details.";
    }
  }
  function closeTicketDetails() {
    ticketModal?.classList.remove("show");
    document.body.style.overflow = "";
    currentTicket = null;
  }

  async function reloadTickets() {
    const response = await getMyTickets();
    tickets = Array.isArray(response.tickets) ? response.tickets : [];
    updateStatistics();
    renderTickets();
  }

  document.querySelectorAll("[data-ticket-view]").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.ticketView || "ALL";
      document
        .querySelectorAll("[data-ticket-view]")
        .forEach((item) => item.classList.toggle("active", item === button));
      currentPage = 1;
      updateStatistics();
      renderTickets();
    });
  });
  [
    "ticketSearch",
    "statusFilter",
    "priorityFilter",
    "categoryFilter",
    "sortFilter",
  ].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      currentPage = 1;
      renderTickets();
    });
    $(id)?.addEventListener("change", () => {
      currentPage = 1;
      renderTickets();
    });
  });
  $("clearFilters")?.addEventListener("click", () => {
    [
      "ticketSearch",
      "statusFilter",
      "priorityFilter",
      "categoryFilter",
    ].forEach((id) => {
      if ($(id)) $(id).value = "";
    });
    if ($("sortFilter")) $("sortFilter").value = "newest";
    currentPage = 1;
    renderTickets();
  });
  $("emptyClearFilters")?.addEventListener("click", () =>
    $("clearFilters")?.click(),
  );
  $("previousPage")?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTickets();
    }
  });
  $("nextPage")?.addEventListener("click", () => {
    if (currentPage < Math.ceil(visibleTickets().length / rowsPerPage)) {
      currentPage++;
      renderTickets();
    }
  });
  $("closeTicketModal")?.addEventListener("click", closeTicketDetails);
  $("closeModalButton")?.addEventListener("click", closeTicketDetails);
  ticketModal?.addEventListener("click", (event) => {
    if (event.target === ticketModal) closeTicketDetails();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTicketDetails();
  });

  $("startWorkButton")?.addEventListener("click", async () => {
    if (!currentTicket) return;
    const button = $("startWorkButton");
    button.disabled = true;
    try {
      await startTicketWork(currentTicket.id);
      $("ticketWorkMessage").textContent =
        "Work started. The ticket is now In Progress.";
      await reloadTickets();
      const data = await getTicketDetails(currentTicket.id);
      renderTicketDetails(data);
    } catch (error) {
      $("ticketWorkMessage").textContent =
        error.message || "Unable to start work.";
      button.disabled = false;
    }
  });

  $("resolveTicketButton")?.addEventListener("click", async () => {
    if (!currentTicket) return;
    const resolution = $("ticketResolutionInput").value.trim();
    if (resolution.length < 10) {
      $("ticketWorkMessage").textContent =
        "Please enter at least 10 characters describing the resolution.";
      return;
    }
    const button = $("resolveTicketButton");
    button.disabled = true;
    try {
      await resolveTicket(currentTicket.id, resolution);
      $("ticketWorkMessage").textContent =
        "Resolution submitted successfully. The ticket creator has been notified.";
      await reloadTickets();
      const data = await getTicketDetails(currentTicket.id);
      renderTicketDetails(data);
    } catch (error) {
      $("ticketWorkMessage").textContent =
        error.message || "Unable to submit resolution.";
      button.disabled = false;
    }
  });

  $("addTicketCommentButton")?.addEventListener("click", async () => {
    if (!currentTicket) return;
    const input = $("ticketCommentInput");
    const comment = input.value.trim();
    if (!comment) return;
    const button = $("addTicketCommentButton");
    button.disabled = true;
    try {
      await addTicketComment(currentTicket.id, comment);
      input.value = "";
      const data = await getTicketDetails(currentTicket.id);
      renderTicketDetails(data);
    } catch (error) {
      alert(error.message || "Unable to add comment.");
    } finally {
      button.disabled = false;
    }
  });
  try {
    const session = await getCurrentUser();
    currentUser = session.user || null;
    const role = normalize(currentUser?.role);
    if (role === "ADMIN") window.location.replace("dashboard.html");
    await reloadTickets();
    if (role === "MANAGER") {
      document
        .querySelectorAll('[data-ticket-view="ASSIGNED"]')
        .forEach((button) => (button.hidden = true));
      $("employeeWorkActions").hidden = true;
    }
  } catch (error) {
    console.error("My Tickets API failed:", error);
    ticketBody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent =
      error.message || "Unable to load tickets. Please refresh.";
    row.appendChild(cell);
    ticketBody.appendChild(row);
  }
});
