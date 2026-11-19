/* Climentos WMP - real Raise Ticket form integration */
document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("raiseTicketForm");
  if (!form) return;

  const titleInput = document.getElementById("ticketTitle");
  const descriptionInput = document.getElementById("ticketDescription");
  const categoryInput = document.getElementById("ticketCategory");
  const departmentInput = document.getElementById("ticketDepartment");
  const priorityInput = document.getElementById("ticketPriority");
  const attachmentInput = document.getElementById("ticketAttachment");
  const attachmentPreview = document.getElementById("attachmentPreview");
  const submitButton = document.getElementById("submitTicketButton");
  const submitButtonText = document.getElementById("submitButtonText");
  const submissionMessage = document.getElementById("submissionMessage");

  const errorElements = {
    title: document.getElementById("titleError"),
    description: document.getElementById("descriptionError"),
    category: document.getElementById("categoryError"),
    department: document.getElementById("departmentError"),
    priority: document.getElementById("priorityError"),
    attachment: document.getElementById("attachmentError"),
  };
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const allowedExtensions = ["pdf", "png", "jpg", "jpeg", "doc", "docx", "txt"];
  let attachmentValid = true;

  function showError(field, message) {
    if (errorElements[field]) errorElements[field].textContent = message;
  }
  function clearErrors() {
    Object.values(errorElements).forEach((el) => {
      if (el) el.textContent = "";
    });
    if (submissionMessage) {
      submissionMessage.textContent = "";
      submissionMessage.className = "submission-message";
    }
  }
  function setMessage(message, type) {
    if (!submissionMessage) return;
    submissionMessage.textContent = message;
    submissionMessage.className = `submission-message ${type}`;
  }

  // Server session is the source of truth. Never trust localStorage for role/identity.
  try {
    const sessionResult = await getCurrentUser();
    const role = String(sessionResult.user?.role || "").toUpperCase();
    if (!["EMPLOYEE", "MANAGER"].includes(role)) {
      window.location.replace("dashboard.html");
      return;
    }
    const roleLabel = document.getElementById("currentRoleLabel");
    if (roleLabel) roleLabel.textContent = role;
  } catch (error) {
    // global.js also enforces this redirect; this prevents an unauthenticated form use.
    window.location.replace("login.html");
    return;
  }

  // Load actual active departments from MySQL.
  try {
    const result = await getDepartments();
    const departments = result.departments || [];
    departmentInput.innerHTML = '<option value="">Select department</option>';
    departments.forEach((department) => {
      const option = document.createElement("option");
      option.value = String(department.id);
      option.textContent = department.department_name;
      departmentInput.appendChild(option);
    });
    if (!departments.length) {
      showError(
        "department",
        "No active departments are configured. Contact your administrator.",
      );
      departmentInput.disabled = true;
      if (submitButton) submitButton.disabled = true;
    }
  } catch (error) {
    showError("department", error.message || "Unable to load departments.");
    departmentInput.disabled = true;
    if (submitButton) submitButton.disabled = true;
  }

  titleInput?.addEventListener("input", () => {
    const counter = document.getElementById("titleCount");
    if (counter) counter.textContent = `${titleInput.value.length} / 150`;
  });
  descriptionInput?.addEventListener("input", () => {
    const counter = document.getElementById("descriptionCount");
    if (counter)
      counter.textContent = `${descriptionInput.value.length} / 2000`;
  });

  attachmentInput?.addEventListener("change", () => {
    if (attachmentPreview) attachmentPreview.textContent = "";
    showError("attachment", "");
    const file = attachmentInput.files?.[0];
    attachmentValid = true;
    if (!file) return;
    const extension = file.name.includes(".")
      ? file.name.split(".").pop().toLowerCase()
      : "";
    if (!allowedExtensions.includes(extension)) {
      showError("attachment", "This file type is not supported.");
      attachmentValid = false;
      attachmentInput.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showError("attachment", "File size must not exceed 5 MB.");
      attachmentValid = false;
      attachmentInput.value = "";
      return;
    }
    if (attachmentPreview)
      attachmentPreview.textContent = `✓ Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  });

  function validateForm() {
    clearErrors();
    let valid = true;
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    if (title.length < 5) {
      showError("title", "Title must contain at least 5 characters.");
      valid = false;
    }
    if (description.length < 15) {
      showError(
        "description",
        "Please provide at least 15 characters of detail.",
      );
      valid = false;
    }
    if (!categoryInput.value) {
      showError("category", "Please select a ticket category.");
      valid = false;
    }
    if (!departmentInput.value) {
      showError("department", "Please select a department.");
      valid = false;
    }
    if (!priorityInput.value) {
      showError("priority", "Please select a priority.");
      valid = false;
    }
    if (!attachmentValid) {
      showError("attachment", "Please select a valid attachment.");
      valid = false;
    }
    return valid;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateForm()) return;
    const payload = new FormData();
    payload.append("title", titleInput.value.trim());
    payload.append("description", descriptionInput.value.trim());
    payload.append("category", categoryInput.value);
    payload.append("department_id", departmentInput.value);
    payload.append("priority", priorityInput.value);
    if (attachmentInput.files?.[0])
      payload.append("attachment", attachmentInput.files[0]);

    if (submitButton) submitButton.disabled = true;
    if (submitButtonText) submitButtonText.textContent = "Submitting...";
    try {
      const result = await createTicket(payload);
      const ticket = result.ticket;
      setMessage(
        `Ticket ${ticket.ticket_number} created successfully.`,
        "success",
      );
      form.reset();
      if (attachmentPreview) attachmentPreview.textContent = "";
      attachmentValid = true;
      document.getElementById("titleCount").textContent = "0 / 150";
      document.getElementById("descriptionCount").textContent = "0 / 2000";
    } catch (error) {
      setMessage(
        error.message || "Ticket could not be created. Please try again.",
        "error",
      );
    } finally {
      if (submitButton) submitButton.disabled = false;
      if (submitButtonText) submitButtonText.textContent = "Submit Ticket";
    }
  });
});
