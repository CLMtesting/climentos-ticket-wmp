/* Real MySQL-backed User Management. Admin-only access is also enforced by Flask. */
document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);
  const form = $("userForm"),
    modal = $("userModal"),
    detailsModal = $("userDetailsModal");
  let users = [],
    departments = [],
    managers = [],
    page = 1,
    editingId = null;
  const pageSize = 7;
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
  const initials = (name) =>
    String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0] || "")
      .join("")
      .toUpperCase();
  const roleLabel = (role) =>
    ({ ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" })[role] ||
    role;
  const dateText = (value) =>
    value
      ? new Date(value).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";
  const message = (text, error = false) => {
    $("userFormMessage").textContent = text;
    $("userFormMessage").style.color = error ? "var(--danger, #c0392b)" : "";
  };

  function setProfile(user) {
    document
      .querySelectorAll(".js-user-name")
      .forEach((el) => (el.textContent = user.name || "User"));

    document
      .querySelectorAll(".js-user-role")
      .forEach((el) => (el.textContent = roleLabel(user.role)));

    document.querySelectorAll(".js-user-avatar").forEach((el) => {
      el.textContent = String(user.name || "U")
        .trim()
        .charAt(0)
        .toUpperCase();
    });
  }

  function fillSelect(select, rows, valueKey, labelKey, firstLabel) {
    const current = select.value;
    select.innerHTML =
      `<option value="">${esc(firstLabel)}</option>` +
      rows
        .map(
          (r) =>
            `<option value="${esc(r[valueKey])}">${esc(r[labelKey])}</option>`,
        )
        .join("");
    if (rows.some((r) => String(r[valueKey]) === String(current)))
      select.value = current;
  }
  function filteredUsers() {
    const q = $("userSearch").value.trim().toLowerCase(),
      role = $("userRoleFilter").value,
      dept = $("userDepartmentFilter").value,
      status = $("userStatusFilter").value;
    return users.filter((u) => {
      const text = `${u.full_name} ${u.email} ${u.employee_code}`.toLowerCase();
      return (
        (!q || text.includes(q)) &&
        (!role || u.role === role) &&
        (!dept || String(u.department_id || "") === dept) &&
        (!status || (u.is_active ? "Active" : "Inactive") === status)
      );
    });
  }
  function updateStats() {
    $("totalUsers").textContent = users.length;
    $("activeUsers").textContent = users.filter((u) => u.is_active).length;
    $("managerUsers").textContent = users.filter(
      (u) => u.role === "MANAGER",
    ).length;
    $("employeeUsers").textContent = users.filter(
      (u) => u.role === "EMPLOYEE",
    ).length;
  }
  function render() {
    const list = filteredUsers(),
      pages = Math.max(1, Math.ceil(list.length / pageSize));
    page = Math.min(page, pages);
    const start = (page - 1) * pageSize,
      shown = list.slice(start, start + pageSize);
    $("usersTableBody").innerHTML = shown
      .map(
        (u) => `
      <tr>
        <td><div class="user-identity"><span class="user-row-avatar">${esc(initials(u.full_name))}</span><span><strong>${esc(u.full_name)}</strong><small>${esc(u.email)}</small></span></div></td>
        <td>${esc(u.employee_code)}</td><td>${esc(u.department_name || "—")}</td>
        <td><span class="user-role-pill role-${esc(u.role.toLowerCase())}">${esc(roleLabel(u.role))}</span></td>
        <td>${dateText(u.created_at)}</td><td><span class="user-status-pill ${u.is_active ? "active" : "inactive"}">${u.is_active ? "Active" : "Inactive"}</span></td>
        <td><div class="user-row-actions"><button type="button" data-action="view" data-id="${u.id}">View</button><button type="button" data-action="edit" data-id="${u.id}">Edit</button><button type="button" data-action="toggle" data-id="${u.id}">${u.is_active ? "Deactivate" : "Activate"}</button></div></td>
      </tr>`,
      )
      .join("");
    $("usersEmpty").hidden = list.length !== 0;
    $("usersTableBody").parentElement.parentElement.hidden = list.length === 0;
    $("usersCount").textContent =
      `${list.length} user${list.length === 1 ? "" : "s"}`;
    $("usersPaginationInfo").textContent = list.length
      ? `Showing ${start + 1}-${start + shown.length} of ${list.length} users`
      : "Showing 0 users";
    $("usersPageNumber").textContent = `${page} / ${pages}`;
    $("previousUsersPage").disabled = page <= 1;
    $("nextUsersPage").disabled = page >= pages;
    updateStats();
  }
  async function loadUsers() {
    $("usersTableBody").innerHTML =
      '<tr><td colspan="7">Loading users...</td></tr>';
    try {
      const data = await getAdminUsers();
      users = data.users || [];
      departments = data.departments || [];
      managers = data.managers || [];
      fillSelect(
        $("userDepartmentFilter"),
        departments,
        "id",
        "department_name",
        "All departments",
      );
      fillSelect(
        $("userDepartment"),
        departments,
        "id",
        "department_name",
        "No department",
      );
      fillSelect(
        $("userManager"),
        managers,
        "id",
        "full_name",
        "No reporting manager",
      );
      render();
    } catch (err) {
      $("usersTableBody").innerHTML = "";
      $("usersEmpty").hidden = false;
      $("usersEmpty").textContent = err.message;
      if (
        err.message.toLowerCase().includes("permission") ||
        err.message.includes("401")
      )
        location.replace("dashboard.html");
    }
  }
  function openModal(user = null) {
    editingId = user ? Number(user.id) : null;
    form.reset();
    $("userModalTitle").textContent = user ? "Edit User" : "Add New User";
    $("saveUserButton").textContent = user ? "Save Changes" : "Add User";
    $("userEmployeeId").value = user?.employee_code || "Generated after saving";
    $("userFullName").value = user?.full_name || "";
    $("userEmail").value = user?.email || "";
    $("userDepartment").value = user?.department_id || "";
    $("userRole").value = user?.role || "EMPLOYEE";
    $("userManager").value = user?.manager_id || "";
    $("userPhone").value = user?.phone || "";
    $("userJobTitle").value = user?.job_title || "";
    $("userPassword").value = "";
    $("userPassword").required = !user;
    $("userPassword").placeholder = user
      ? "Leave blank to keep current password"
      : "Minimum 8 characters";
    message(
      user
        ? "Leave password blank to keep the existing password."
        : "A password of at least 8 characters is required.",
    );
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    if (!detailsModal.classList.contains("show"))
      document.body.style.overflow = "";
  }
  function showDetails(u) {
    $("detailsUserName").textContent = u.full_name;
    $("detailsUserId").textContent = u.employee_code;
    $("detailsUserEmail").textContent = u.email;
    $("detailsUserDepartment").textContent = u.department_name || "—";
    $("detailsUserRole").textContent = roleLabel(u.role);
    $("detailsUserJoined").textContent = dateText(u.created_at);
    $("detailsUserStatus").textContent = u.is_active ? "Active" : "Inactive";
    detailsModal.classList.add("show");
    detailsModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeDetails() {
    detailsModal.classList.remove("show");
    detailsModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  $("addUserButton").addEventListener("click", () => openModal());
  $("closeUserModal").addEventListener("click", closeModal);
  $("cancelUserModal").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  $("closeUserDetails").addEventListener("click", closeDetails);
  $("closeUserDetailsButton").addEventListener("click", closeDetails);
  detailsModal.addEventListener("click", (e) => {
    if (e.target === detailsModal) closeDetails();
  });
  $("userRole").addEventListener("change", () => {
    if ($("userRole").value === "MANAGER") $("userManager").value = "";
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("saveUserButton").disabled = true;
    const payload = {
      full_name: $("userFullName").value.trim(),
      email: $("userEmail").value.trim(),
      role: $("userRole").value,
      department_id: $("userDepartment").value || null,
      manager_id:
        $("userRole").value === "EMPLOYEE"
          ? $("userManager").value || null
          : null,
      phone: $("userPhone").value.trim(),
      job_title: $("userJobTitle").value.trim(),
      password: $("userPassword").value,
    };
    try {
      const result = editingId
        ? await updateAdminUser(editingId, payload)
        : await createAdminUser(payload);
      closeModal();
      await loadUsers();
      if (result.employee_code)
        alert(`User created successfully. Display ID: ${result.employee_code}`);
    } catch (err) {
      message(err.message, true);
    } finally {
      $("saveUserButton").disabled = false;
    }
  });
  $("usersTableBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const u = users.find((x) => Number(x.id) === Number(btn.dataset.id));
    if (!u) return;
    if (btn.dataset.action === "view") showDetails(u);
    if (btn.dataset.action === "edit") openModal(u);
    if (btn.dataset.action === "toggle") {
      const next = !u.is_active;
      if (
        !confirm(
          `${next ? "Activate" : "Deactivate"} ${u.full_name}'s account?`,
        )
      )
        return;
      btn.disabled = true;
      try {
        await updateAdminUserStatus(u.id, next);
        await loadUsers();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    }
  });
  [
    $("userSearch"),
    $("userRoleFilter"),
    $("userDepartmentFilter"),
    $("userStatusFilter"),
  ].forEach((el) => {
    el.addEventListener(el === $("userSearch") ? "input" : "change", () => {
      page = 1;
      render();
    });
  });
  $("globalSearch").addEventListener("input", () => {
    $("userSearch").value = $("globalSearch").value;
    page = 1;
    render();
  });
  $("clearUserFilters").addEventListener("click", () => {
    $("userSearch").value = "";
    $("globalSearch").value = "";
    $("userRoleFilter").value = "";
    $("userDepartmentFilter").value = "";
    $("userStatusFilter").value = "";
    page = 1;
    render();
  });
  $("resetUsersEmpty").addEventListener("click", () =>
    $("clearUserFilters").click(),
  );
  $("previousUsersPage").addEventListener("click", () => {
    if (page > 1) {
      page--;
      render();
    }
  });
  $("nextUsersPage").addEventListener("click", () => {
    if (page < Math.ceil(filteredUsers().length / pageSize)) {
      page++;
      render();
    }
  });
  $("exportUsersButton").addEventListener("click", () => {
    const rows = [
      ["Display ID", "Name", "Email", "Department", "Role", "Joined", "Status"],
      ...filteredUsers().map((u) => [
        u.employee_code,
        u.full_name,
        u.email,
        u.department_name || "",
        u.role,
        u.created_at,
        u.is_active ? "Active" : "Inactive",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "climentos-users.csv";
    a.click();
    URL.revokeObjectURL(url);
  });
  
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeDetails();
    }
  });
  try {
    const me = await getCurrentUser();
    if (!me.user || me.user.role !== "ADMIN") {
      location.replace("dashboard.html");
      return;
    }
    setProfile(me.user);
  } catch (_) {
    location.replace("login.html");
    return;
  }
  await loadUsers();
});
