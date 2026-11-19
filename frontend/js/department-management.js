/* Department Management - live MySQL integration. Admin-only page. */
document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) =>
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
  const modal = $("departmentModal"),
    details = $("departmentDetailsModal"),
    form = $("departmentForm");
  let currentUser = null,
    departments = [],
    page = 1,
    editingId = null;
  const pageSize = 6;
  const showMessage = (message, error = false) => {
    const el = $("departmentFormMessage");
    if (el) {
      el.textContent = message;
      el.style.color = error ? "#dc2626" : "";
    }
  };
  const dateText = (value) =>
    value
      ? new Date(value).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";

  function setUser(user) {
    const name = user.name || user.full_name || "User";

    document
      .querySelectorAll(".js-user-name")
      .forEach((el) => (el.textContent = name));

    document.querySelectorAll(".js-user-role").forEach(
      (el) =>
        (el.textContent = String(user.role || "")
          .toLowerCase()
          .replace(/^./, (c) => c.toUpperCase())),
    );

    document
      .querySelectorAll(".js-user-avatar")
      .forEach(
        (el) => (el.textContent = name.trim().charAt(0).toUpperCase() || "U"),
      );
  }

  function openModal(dept = null) {
    editingId = dept ? Number(dept.id) : null;
    form.reset();
    $("departmentModalTitle").textContent = dept
      ? "Edit Department"
      : "Add Department";
    $("saveDepartmentButton").textContent = dept
      ? "Save Changes"
      : "Add Department";
    $("departmentName").value = dept?.department_name || "";
    $("departmentStatus").value = dept
      ? dept.is_active
        ? "Active"
        : "Inactive"
      : "Active";
    $("departmentDescription").value = dept?.description || "";
    showMessage("Changes will be saved to MySQL.");
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    if (!details.classList.contains("show")) document.body.style.overflow = "";
  }
  function showDetails(d) {
    $("detailsDepartmentName").textContent = d.department_name;
    $("detailsDepartmentId").textContent = `#${d.id}`;
    $("detailsDepartmentManager").textContent =
      d.managers || "Not assigned through teams";
    $("detailsDepartmentMembers").textContent = String(d.member_count ?? 0);
    $("detailsDepartmentStatus").textContent = d.is_active
      ? "Active"
      : "Inactive";
    $("detailsDepartmentDescription").textContent =
      d.description || "No description provided.";
    details.classList.add("show");
    details.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeDetails() {
    details.classList.remove("show");
    details.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  function filtered() {
    const q = $("departmentSearch").value.trim().toLowerCase(),
      status = $("departmentStatusFilter").value;
    return departments.filter(
      (d) =>
        (!q ||
          `${d.department_name} ${d.id} ${d.managers} ${d.description || ""}`
            .toLowerCase()
            .includes(q)) &&
        (!status || (status === "Active") === d.is_active),
    );
  }
  function render() {
    const rows = filtered(),
      pages = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.min(page, pages);
    const start = (page - 1) * pageSize,
      shown = rows.slice(start, start + pageSize);
    $("departmentsTableBody").innerHTML = shown
      .map(
        (d) => `<tr>
      <td><div class="department-name-cell"><span class="department-symbol">▥</span><span><strong>${esc(d.department_name)}</strong><small>${esc(d.description || "")}</small></span></div></td>
      <td>#${esc(d.id)}</td><td>${esc(d.managers || "Not assigned through teams")}</td><td>${Number(d.member_count) || 0}</td><td>${dateText(d.created_at)}</td>
      <td><span class="department-status ${d.is_active ? "active" : "inactive"}">${d.is_active ? "Active" : "Inactive"}</span></td>
      <td><div class="department-actions"><button data-action="view" data-id="${d.id}">View</button><button data-action="edit" data-id="${d.id}">Edit</button><button data-action="toggle" data-id="${d.id}">${d.is_active ? "Deactivate" : "Activate"}</button></div></td></tr>`,
      )
      .join("");
    $("departmentsEmpty").hidden = rows.length > 0;
    $("departmentsTableBody").parentElement.parentElement.hidden =
      rows.length === 0;
    $("departmentCount").textContent =
      `${rows.length} department${rows.length === 1 ? "" : "s"}`;
    $("departmentPaginationInfo").textContent = rows.length
      ? `Showing ${start + 1}-${start + shown.length} of ${rows.length} departments`
      : "Showing 0 departments";
    $("departmentPageNumber").textContent = `${page} / ${pages}`;
    $("previousDepartmentPage").disabled = page <= 1;
    $("nextDepartmentPage").disabled = page >= pages;
  }
  function updateStats(stats) {
    $("totalDepartments").textContent = stats.total ?? departments.length;
    $("activeDepartments").textContent =
      stats.active ?? departments.filter((d) => d.is_active).length;
    $("totalDepartmentMembers").textContent =
      stats.members ??
      departments.reduce((n, d) => n + Number(d.member_count || 0), 0);
    $("assignedManagers").textContent = stats.assigned_managers ?? 0;
  }
  async function loadDepartments() {
    try {
      const result = await getAdminDepartments();
      departments = result.departments || [];
      updateStats(result.stats || {});
      render();
    } catch (error) {
      $("departmentsTableBody").innerHTML =
        `<tr><td colspan="7">${esc(error.message)}</td></tr>`;
      $("departmentsEmpty").hidden = true;
    }
  }
  try {
    const me = await getCurrentUser();
    currentUser = me.user || me;
    if (currentUser.role !== "ADMIN") {
      alert("You do not have permission to access Department Management.");
      location.replace("dashboard.html");
      return;
    }
    setUser(currentUser);
  } catch (_) {
    location.replace("login.html");
    return;
  }
  $("addDepartmentButton").addEventListener("click", () => openModal());
  $("closeDepartmentModal").addEventListener("click", closeModal);
  $("cancelDepartmentModal").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      department_name: $("departmentName").value.trim(),
      description: $("departmentDescription").value.trim(),
      is_active: $("departmentStatus").value === "Active",
    };
    const save = $("saveDepartmentButton");
    save.disabled = true;
    try {
      if (editingId) {
        await updateAdminDepartment(editingId, payload);
      } else {
        await createAdminDepartment(payload);
      }
      closeModal();
      await loadDepartments();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      save.disabled = false;
    }
  });
  $("departmentsTableBody").addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-action]");
    if (!button) return;
    const dept = departments.find(
      (d) => Number(d.id) === Number(button.dataset.id),
    );
    if (!dept) return;
    if (button.dataset.action === "view") showDetails(dept);
    if (button.dataset.action === "edit") openModal(dept);
    if (button.dataset.action === "toggle") {
      const next = !dept.is_active;
      if (
        !confirm(
          `Are you sure you want to ${next ? "activate" : "deactivate"} ${dept.department_name}?`,
        )
      )
        return;
      button.disabled = true;
      try {
        await updateAdminDepartmentStatus(dept.id, next);
        await loadDepartments();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    }
  });
  $("closeDepartmentDetails").addEventListener("click", closeDetails);
  $("closeDepartmentDetailsButton").addEventListener("click", closeDetails);
  details.addEventListener("click", (e) => {
    if (e.target === details) closeDetails();
  });
  function clearFilters() {
    $("departmentSearch").value = "";
    $("globalSearch").value = "";
    $("departmentStatusFilter").value = "";
    page = 1;
    render();
  }
  $("departmentSearch").addEventListener("input", () => {
    page = 1;
    render();
  });
  $("globalSearch").addEventListener("input", () => {
    $("departmentSearch").value = $("globalSearch").value;
    page = 1;
    render();
  });
  $("departmentStatusFilter").addEventListener("change", () => {
    page = 1;
    render();
  });
  $("clearDepartmentFilters").addEventListener("click", clearFilters);
  $("resetDepartmentFilters").addEventListener("click", clearFilters);
  $("previousDepartmentPage").addEventListener("click", () => {
    if (page > 1) {
      page--;
      render();
    }
  });
  $("nextDepartmentPage").addEventListener("click", () => {
    if (page < Math.ceil(filtered().length / pageSize)) {
      page++;
      render();
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("globalSearch").focus();
    }
    if (e.key === "Escape") {
      closeModal();
      closeDetails();
    }
  });

  await loadDepartments();
});
