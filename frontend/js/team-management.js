/* Climentos WMP - Team Management (MySQL-backed; no demo/localStorage data) */
document.addEventListener("DOMContentLoaded", async () => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = {
    role: "",
    teams: [],
    members: [],
    available: [],
    managers: [],
    departments: [],
    page: 1,
    size: 7,
  };
  const safeText = (v) => String(v ?? "");
  const initials = (name) =>
    safeText(name)
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0] || "")
      .join("")
      .toUpperCase();
  const dateText = (value) => {
    if (!value) return "—";
    const d = new Date(String(value).replace(" ", "T"));
    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
  };
  const open = (id) => {
    $(id)?.classList.add("show");
    $(id)?.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };
  const close = (id) => {
    $(id)?.classList.remove("show");
    $(id)?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };
  const setOptions = (id, rows, value, label, placeholder) => {
    const el = $(id);
    if (!el) return;
    el.replaceChildren(new Option(placeholder, ""));
    rows.forEach((r) => el.add(new Option(label(r), r[value])));
  };
  function renderStats(stats = {}) {
    $("totalMembers").textContent = stats.total_members ?? 0;
    $("departmentCount").textContent = stats.department_count ?? 0;
    $("leadCount").textContent = stats.team_count ?? 0;
    $("activeCount").textContent = stats.active_members ?? 0;
  }
  function renderTeams() {
    const body = $("teamsBody");
    if (!body) return;
    body.replaceChildren();
    state.teams.forEach((team) => {
      const tr = document.createElement("tr");
      [
        team.team_name,
        team.department_name || "—",
        team.manager_name || "Not assigned",
        String(team.member_count ?? 0),
        team.is_active ? "Active" : "Inactive",
      ].forEach((v, i) => {
        const td = document.createElement("td");
        td.textContent = v;
        if (i === 4)
          td.className = team.is_active ? "status-active" : "status-inactive";
        tr.appendChild(td);
      });
      const td = document.createElement("td");
      if (state.role === "ADMIN") {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "member-view-button";
        b.textContent = "Edit";
        b.addEventListener("click", () => editTeam(team));
        td.appendChild(b);
      } else td.textContent = "—";
      tr.appendChild(td);
      body.appendChild(tr);
    });
    $("teamCountLabel").textContent =
      `${state.teams.length} team${state.teams.length === 1 ? "" : "s"}`;
    $("teamsEmpty").hidden = state.teams.length > 0;
  }
  function filteredMembers() {
    const q = $("memberSearch").value.trim().toLowerCase();
    const dep = $("departmentFilter").value,
      role = $("roleFilter").value,
      status = $("memberStatusFilter").value;
    const team = $("teamFilter")?.value || "";
    return state.members.filter((m) => {
      const hay = [
        m.employee_code,
        m.full_name,
        m.email,
        m.department_name,
        m.team_name,
        m.role_name,
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!q || hay.includes(q)) &&
        (!dep || String(m.department_id || "") === dep) &&
        (!role || m.role_name === role) &&
        (!status || (m.is_active ? "Active" : "Inactive") === status) &&
        (!team || String(m.team_id || "") === team)
      );
    });
  }
  function renderMembers() {
    const rows = filteredMembers(),
      pages = Math.max(1, Math.ceil(rows.length / state.size));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.size,
      visible = rows.slice(start, start + state.size),
      body = $("teamMembersBody");
    body.replaceChildren();
    visible.forEach((m) => {
      const tr = document.createElement("tr");
      const identity = document.createElement("td");
      identity.className = "member-cell";
      const av = document.createElement("span");
      av.className = "member-avatar";
      av.textContent = initials(m.full_name);
      const box = document.createElement("span");
      box.className = "member-identity";
      const name = document.createElement("strong");
      name.textContent = m.full_name;
      const email = document.createElement("small");
      email.textContent = m.email;
      box.append(name, email);
      identity.append(av, box);
      tr.appendChild(identity);
      [
        m.employee_code,
        m.department_name || "—",
        m.role_name || "Employee",
        dateText(m.created_at),
        m.is_active ? "Active" : "Inactive",
      ].forEach((v, i) => {
        const td = document.createElement("td");
        td.textContent = v;
        if (i === 5)
          td.className = m.is_active ? "status-active" : "status-inactive";
        tr.appendChild(td);
      });
      const action = document.createElement("td");
      const view = document.createElement("button");
      view.type = "button";
      view.className = "member-view-button";
      view.textContent = "View";
      view.addEventListener("click", () => showMember(m));
      action.appendChild(view);
      if (
        m.team_id &&
        (state.role === "ADMIN" ||
          state.teams.some((t) => Number(t.id) === Number(m.team_id)))
      ) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "team-clear-button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => removeMember(m));
        action.appendChild(remove);
      }
      tr.appendChild(action);
      body.appendChild(tr);
    });
    $("memberCountLabel").textContent = `${rows.length} members`;
    $("memberPaginationInfo").textContent = rows.length
      ? `Showing ${start + 1}-${start + visible.length} of ${rows.length} members`
      : "Showing 0 members";
    $("memberPageNumber").textContent = `${state.page} / ${pages}`;
    $("previousMemberPage").disabled = state.page <= 1;
    $("nextMemberPage").disabled = state.page >= pages;
    $("teamEmpty").hidden = rows.length > 0;
  }
  function populateSelects() {
    const unique = [
      ...new Map(state.available.map((x) => [Number(x.id), x])).values(),
    ];
    setOptions(
      "memberUserId",
      unique,
      "id",
      (u) =>
        `${u.employee_code || `CLM-EMP-${String(u.id).padStart(3, "0")}`} · ${u.full_name} (${u.email})`,
      "Select employee",
    );
    setOptions(
      "memberTeamId",
      state.teams.filter((t) => t.is_active),
      "id",
      (t) => t.team_name,
      "Select team",
    );
    setOptions(
      "teamDepartment",
      state.departments,
      "id",
      (d) => d.department_name,
      "No department",
    );
    setOptions(
      "teamManager",
      state.managers,
      "id",
      (m) => m.full_name,
      "No manager assigned",
    );
    setOptions(
      "departmentFilter",
      state.departments,
      "id",
      (d) => d.department_name,
      "All Departments",
    );
    setOptions(
      "roleFilter",
      [{ role_name: "EMPLOYEE" }],
      "role_name",
      (r) => "Employee",
      "All Roles",
    );
    setOptions(
      "teamFilter",
      state.teams,
      "id",
      (t) => t.team_name,
      "All Teams",
    );
  }
  function showMember(m) {
    $("viewMemberName").textContent = m.full_name;
    $("viewMemberAvatar").textContent = initials(m.full_name);
    $("viewMemberEmail").textContent = m.email;
    $("viewMemberRole").textContent = m.role_name || "Employee";
    $("viewMemberId").textContent = m.employee_code;
    $("viewMemberDepartment").textContent = m.department_name || "—";
    $("viewMemberJoined").textContent = dateText(m.created_at);
    $("viewMemberStatus").textContent = m.is_active ? "Active" : "Inactive";
    open("viewMemberModal");
  }
  function editTeam(t) {
    $("teamForm").reset();
    $("teamId").value = t.id;
    $("teamName").value = t.team_name;
    $("teamDepartment").value = t.department_id || "";
    $("teamManager").value = t.manager_id || "";
    $("teamDescription").value = t.description || "";
    $("teamStatus").value = t.is_active ? "1" : "0";
    $("teamModalTitle").textContent = "Edit Team";
    $("saveTeamButton").textContent = "Save Changes";
    open("teamModal");
  }
  async function load() {
    const result = await getTeamManagementData();
    state.role = String(result.role || "").toUpperCase();
    state.teams = result.teams || [];
    state.members = result.members || [];
    state.available = result.available_members || [];
    state.managers = result.managers || [];
    state.departments = result.departments || [];
    $("teamPageTitle").innerHTML =
      state.role === "MANAGER"
        ? "My Team <span>✦</span>"
        : "Team Management <span>✦</span>";
    $("teamPageSubtitle").textContent =
      state.role === "MANAGER"
        ? "View your direct reports and members of teams you manage."
        : "Create teams, assign Managers and organize employee memberships.";
    $("memberPanelTitle").textContent =
      state.role === "MANAGER" ? "My Team Members" : "Workspace Members";
    $("memberPanelSubtitle").textContent =
      state.role === "MANAGER"
        ? "Employees reporting to you and members of your managed teams."
        : "Employee accounts registered in the workspace.";
    $("createTeamButton").hidden = state.role !== "ADMIN";
    $("addMemberButton").disabled =
      state.teams.filter((t) => t.is_active).length === 0;
    renderStats(result.stats);
    populateSelects();
    renderTeams();
    renderMembers();
  }
  async function removeMember(m) {
    if (!m.team_id) return alert("This employee has no team assignment.");
    if (
      !confirm(
        `Remove ${m.full_name} from ${m.team_name}? Their direct Manager assignment will remain unchanged.`,
      )
    )
      return;
    try {
      await removeTeamMember(m.team_id, m.id);
      await load();
    } catch (e) {
      alert(e.message || "Unable to remove member.");
    }
  }

  $("addMemberButton").addEventListener("click", () => {
    if (!state.teams.some((t) => t.is_active))
      return alert(
        "No active teams are available. Ask an Admin to create a team.",
      );
    $("memberForm").reset();
    populateSelects();
    $("memberFormMessage").textContent =
      "Choose an existing Employee and a team. No new user account will be created.";
    open("memberModal");
  });
  $("memberForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const team = $("memberTeamId").value,
      user = $("memberUserId").value;
    if (!team || !user) return;
    const b = $("saveMemberButton");
    b.disabled = true;
    try {
      const r = await addTeamMember(team, user);
      $("memberFormMessage").textContent = r.message;
      await load();
      setTimeout(() => close("memberModal"), 350);
    } catch (err) {
      $("memberFormMessage").textContent = err.message || "Assignment failed.";
    } finally {
      b.disabled = false;
    }
  });
  $("createTeamButton").addEventListener("click", () => {
    $("teamForm").reset();
    $("teamId").value = "";
    $("teamStatus").value = "1";
    $("teamModalTitle").textContent = "Create Team";
    $("saveTeamButton").textContent = "Create Team";
    populateSelects();
    open("teamModal");
  });
  $("teamForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("teamId").value,
      b = $("saveTeamButton");
    b.disabled = true;
    const data = {
      team_name: $("teamName").value.trim(),
      department_id: $("teamDepartment").value || null,
      manager_id: $("teamManager").value || null,
      description: $("teamDescription").value.trim(),
      is_active: $("teamStatus").value === "1",
    };
    try {
      const r = id ? await updateTeam(id, data) : await createTeam(data);
      $("teamFormMessage").textContent = r.message || "Saved.";
      await load();
      setTimeout(() => close("teamModal"), 350);
    } catch (err) {
      $("teamFormMessage").textContent = err.message || "Unable to save team.";
    } finally {
      b.disabled = false;
    }
  });
  [
    ["closeMemberModal", "memberModal"],
    ["cancelMemberModal", "memberModal"],
    ["closeTeamModal", "teamModal"],
    ["cancelTeamModal", "teamModal"],
    ["closeViewMemberModal", "viewMemberModal"],
    ["closeViewMemberButton", "viewMemberModal"],
  ].forEach(([b, m]) => $(b)?.addEventListener("click", () => close(m)));
  ["memberModal", "teamModal", "viewMemberModal"].forEach((id) =>
    $(id)?.addEventListener("click", (e) => {
      if (e.target === $(id)) close(id);
    }),
  );
  [
    "memberSearch",
    "departmentFilter",
    "roleFilter",
    "memberStatusFilter",
    "teamFilter",
  ].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      state.page = 1;
      renderMembers();
    });
    $(id)?.addEventListener("change", () => {
      state.page = 1;
      renderMembers();
    });
  });
  $("clearMemberFilters").addEventListener("click", () => {
    [
      "memberSearch",
      "departmentFilter",
      "roleFilter",
      "memberStatusFilter",
      "teamFilter",
    ].forEach((id) => {
      if ($(id)) $(id).value = "";
    });
    state.page = 1;
    renderMembers();
  });
  $("emptyClearMembers").addEventListener("click", () =>
    $("clearMemberFilters").click(),
  );
  $("previousMemberPage").addEventListener("click", () => {
    if (state.page > 1) {
      state.page--;
      renderMembers();
    }
  });
  $("nextMemberPage").addEventListener("click", () => {
    state.page++;
    renderMembers();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
      ["memberModal", "teamModal", "viewMemberModal"].forEach(close);
  });

  try {
    const me = await getCurrentUser(),
      role = String(me.user?.role || "").toUpperCase();
    if (!["ADMIN", "MANAGER"].includes(role)) {
      location.replace("dashboard.html");
      return;
    }
    await load();
  } catch (e) {
    console.error("Team Management load failed:", e);
    $("teamMembersBody").innerHTML =
      `<tr><td colspan="7">${String(e.message || "Unable to load data.")}</td></tr>`;
    $("teamEmpty").hidden = true;
  }
});
