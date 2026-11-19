/* Shared API helpers. Flask session cookie is the authentication source. */
async function apiRequest(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  if (!isFormData && options.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers,
  });

  let result = {};
  try {
    result = await response.json();
  } catch (_) {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(result.message || `Request failed (${response.status}).`);
  }
  return result;
}

async function getRoles() {
  return apiRequest("/api/roles");
}
async function getDepartments() {
  return apiRequest("/api/departments");
}
async function loginUser(data) {
  return apiRequest("/api/login", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
async function registerUser(data) {
  return apiRequest("/api/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
async function getCurrentUser() {
  return apiRequest("/api/me");
}
async function logoutUser() {
  return apiRequest("/api/logout", { method: "POST" });
}
async function getMyTickets() {
  return apiRequest("/api/tickets/my");
}
async function getTicketDetails(ticketId) {
  return apiRequest(`/api/tickets/${ticketId}/details`);
}
async function addTicketComment(ticketId, comment) {
  return apiRequest(`/api/tickets/${ticketId}/comments`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}
async function startTicketWork(ticketId) {
  return apiRequest(`/api/tickets/${ticketId}/work-status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "IN_PROGRESS" }),
  });
}
async function resolveTicket(ticketId, resolution) {
  return apiRequest(`/api/tickets/${ticketId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ resolution }),
  });
}
async function getAllTickets() {
  return apiRequest("/api/tickets");
}
async function getTicketAssignmentOptions() {
  return apiRequest("/api/tickets/assignment-options");
}
async function updateTicketAssignment(ticketId, assignment) {
  return apiRequest(`/api/tickets/${ticketId}/assignment`, {
    method: "PATCH",
    body: JSON.stringify(assignment),
  });
}
async function updateTicketStatus(ticketId, status) {
  return apiRequest(`/api/tickets/${ticketId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
async function createTicket(formData) {
  return apiRequest("/api/tickets", {
    method: "POST",
    body: formData,
  });
}
async function getDashboardSummary(period = "month") {
  const query = new URLSearchParams({ period });
  return apiRequest(`/api/dashboard/summary?${query.toString()}`);
}

// Team Management APIs
async function getTeamManagementData() {
  return apiRequest("/api/team-management");
}
async function createTeam(data) {
  return apiRequest("/api/teams", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
async function updateTeam(teamId, data) {
  return apiRequest(`/api/teams/${teamId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
async function addTeamMember(teamId, userId) {
  return apiRequest(`/api/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: Number(userId) }),
  });
}
async function removeTeamMember(teamId, userId) {
  return apiRequest(`/api/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
  });
}

// Admin User Management APIs
async function getAdminUsers() {
  return apiRequest("/api/admin/users");
}
async function createAdminUser(data) {
  return apiRequest("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
async function updateAdminUser(userId, data) {
  return apiRequest(`/api/admin/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
async function updateAdminUserStatus(userId, isActive) {
  return apiRequest(`/api/admin/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: isActive }),
  });
}

// Admin Department Management APIs
async function getAdminDepartments() {
  return apiRequest("/api/admin/departments");
}
async function createAdminDepartment(data) {
  return apiRequest("/api/admin/departments", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
async function updateAdminDepartment(id, data) {
  return apiRequest(`/api/admin/departments/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
async function updateAdminDepartmentStatus(id, isActive) {
  return apiRequest(`/api/admin/departments/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: isActive }),
  });
}

// Role-scoped Reports & Analytics API
async function getReportsSummary(period = "30", departmentId = "") {
  const query = new URLSearchParams({ period: String(period) });
  if (departmentId) query.set("department_id", String(departmentId));
  return apiRequest(`/api/reports/summary?${query.toString()}`);
}

// Notifications - all operations are scoped to the authenticated Flask session.
async function getNotifications(limit = 100) {
  const query = new URLSearchParams({ limit: String(limit) });
  return apiRequest(`/api/notifications?${query.toString()}`);
}
async function setNotificationRead(notificationId, isRead = true) {
  return apiRequest(`/api/notifications/${notificationId}/read`, {
    method: "PATCH",
    body: JSON.stringify({ is_read: Boolean(isRead) }),
  });
}
async function markAllNotificationsRead() {
  return apiRequest("/api/notifications/read-all", { method: "POST" });
}
async function dismissNotification(notificationId) {
  return apiRequest(`/api/notifications/${notificationId}`, {
    method: "DELETE",
  });
}
