/* =========================================================
   CLIMENTOS WMP - MY PROFILE
   Database-connected profile management
   Supports EMPLOYEE, MANAGER and ADMIN
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const form = $("profileForm");
  const message = $("profileMessage");
  const saveButton = form?.querySelector('[type="submit"]');

  let profile = null;
  let editMode = false;

  const roleNames = {
    EMPLOYEE: "Employee",
    MANAGER: "Manager",
    ADMIN: "Admin",
  };

  // -----------------------------------------------------
  // Initials
  // -----------------------------------------------------

  function initials(name) {
    return (
      String(name || "User")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0))
        .join("")
        .toUpperCase() || "U"
    );
  }

  // -----------------------------------------------------
  // Safe text updates
  // -----------------------------------------------------

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = value ?? "";
    });
  }

  // -----------------------------------------------------
  // Messages
  // -----------------------------------------------------

  function showMessage(text, isError = false) {
    if (!message) return;

    message.textContent = text;
    message.classList.toggle("error", isError);
    message.setAttribute("aria-live", "polite");
  }

  // -----------------------------------------------------
  // API request helper
  // -----------------------------------------------------

  async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error("The server returned an invalid response.");
    }

    if (response.status === 401 || response.status === 403) {
      window.location.href = "login.html";
      throw new Error("Your session has expired.");
    }

    if (!response.ok || result.success === false) {
      throw new Error(result.message || "The request could not be completed.");
    }

    return result;
  }

  // -----------------------------------------------------
  // Render logged-in user's actual profile
  // -----------------------------------------------------

  function renderProfile(data) {
    profile = data;

    const name = data.name || "";
    const role = String(data.role || "").toUpperCase();
    const roleLabel = roleNames[role] || role || "User";

    const avatarText = initials(name);
    const department = data.department || "Not assigned";
    const manager = data.manager || "Not assigned";
    const status = data.is_active ? "Active" : "Inactive";

    // Sidebar and topbar identity

    setText(
      ".js-user-name, .user-name, .profile-sidebar-name, .profile-top-name",
      name,
    );

    setText(
      ".js-user-role, .user-role, .profile-sidebar-role, .profile-top-role",
      roleLabel,
    );

    // Topbar and sidebar avatars: show only the first initial
    document
      .querySelectorAll(".js-user-avatar, .user-initial, .profile-avatar-small")
      .forEach((element) => {
        element.textContent = name.trim().charAt(0).toUpperCase() || "U";
      });

    // Main profile header

    if ($("profileInitials")) {
      $("profileInitials").textContent = avatarText;
    }

    if ($("heroName")) {
      $("heroName").textContent = name;
    }

    if ($("heroRole")) {
      $("heroRole").textContent = roleLabel;
    }

    if ($("heroEmployeeId")) {
      $("heroEmployeeId").textContent = data.employee_id || "—";
    }

    if ($("heroDepartment")) {
      $("heroDepartment").textContent = department;
    }

    if ($("heroJoined")) {
      $("heroJoined").textContent = data.joined_date || "—";
    }

    // Account status

    const heroStatus = $("heroStatus");

    if (heroStatus) {
      heroStatus.textContent = status;
      heroStatus.classList.toggle("inactive", !data.is_active);
    }

    // Work information

    if ($("workRole")) {
      $("workRole").textContent = roleLabel;
    }

    if ($("workDepartment")) {
      $("workDepartment").textContent = department;
    }

    if ($("workManager")) {
      $("workManager").textContent = manager;
    }

    if ($("workStatus")) {
      $("workStatus").textContent = status;
      $("workStatus").classList.toggle("active-text", Boolean(data.is_active));
    }

    // Personal information

    if ($("fullName")) {
      $("fullName").value = data.name || "";
    }

    if ($("email")) {
      $("email").value = data.email || "";
    }

    if ($("phone")) {
      $("phone").value = data.phone || "";
    }
  }

  // -----------------------------------------------------
  // Edit mode
  // -----------------------------------------------------

  function setEditMode(enabled) {
    if (!form) return;

    editMode = enabled;

    form.querySelectorAll("input").forEach((input) => {
      input.disabled = !enabled;
    });

    if ($("cancelEdit")) {
      $("cancelEdit").hidden = !enabled;
    }

    if (saveButton) {
      saveButton.hidden = !enabled;
    }

    if ($("editProfileTop")) {
      $("editProfileTop").hidden = enabled;
    }

    if (enabled) {
      $("fullName")?.focus();
    }
  }

  // -----------------------------------------------------
  // Load profile from database
  // -----------------------------------------------------

  async function loadProfile() {
    showMessage("Loading your profile...");

    try {
      const result = await apiRequest("/api/profile");

      if (!result.profile) {
        throw new Error("Profile information was not returned.");
      }

      renderProfile(result.profile);
      setEditMode(false);

      showMessage("Your profile is loaded from the company database.");
    } catch (error) {
      console.error("Profile loading error:", error);
      showMessage(error.message, true);
    }
  }

  // -----------------------------------------------------
  // Edit profile
  // -----------------------------------------------------

  $("editProfileTop")?.addEventListener("click", () => {
    if (!profile) return;

    setEditMode(true);
    showMessage("Edit your name, email address or phone number.");
  });

  // -----------------------------------------------------
  // Cancel editing
  // -----------------------------------------------------

  $("cancelEdit")?.addEventListener("click", () => {
    if (profile) {
      renderProfile(profile);
    }

    setEditMode(false);
    showMessage("Changes cancelled.");
  });

  // -----------------------------------------------------
  // Save profile
  // -----------------------------------------------------

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!editMode) return;

    const payload = {
      full_name: $("fullName")?.value.trim() || "",
      email: $("email")?.value.trim() || "",
      phone: $("phone")?.value.trim() || "",
    };

    if (!payload.full_name || !payload.email) {
      showMessage("Full name and email are required.", true);
      return;
    }

    if (saveButton) {
      saveButton.disabled = true;
    }

    showMessage("Saving your profile...");

    try {
      const result = await apiRequest("/api/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      if (!result.profile) {
        throw new Error("Updated profile was not returned.");
      }

      renderProfile(result.profile);
      setEditMode(false);

      showMessage(result.message || "Profile updated successfully.");
    } catch (error) {
      console.error("Profile update error:", error);
      showMessage(error.message, true);
    } finally {
      if (saveButton) {
        saveButton.disabled = false;
      }
    }
  });

  // -----------------------------------------------------
  // Change password modal
  // -----------------------------------------------------

  const passwordModal = $("passwordModal");
  const passwordForm = $("changePasswordForm");
  const passwordMessage = $("passwordMessage");
  const passwordSubmit = $("changePasswordSubmit");

  function showPasswordMessage(text, isError = false) {
    if (!passwordMessage) return;

    passwordMessage.textContent = text;
    passwordMessage.classList.toggle("error", isError);
  }

  function openPasswordModal() {
    if (!passwordModal) {
      alert("Password modal is missing from employee-profile.html.");
      return;
    }

    passwordForm?.reset();
    showPasswordMessage("");

    passwordModal.classList.add("show");
    passwordModal.setAttribute("aria-hidden", "false");

    $("currentPassword")?.focus();
  }

  function closePasswordModal() {
    passwordModal?.classList.remove("show");
    passwordModal?.setAttribute("aria-hidden", "true");

    passwordForm?.reset();
    showPasswordMessage("");
  }

  $("passwordInfo")?.addEventListener("click", openPasswordModal);

  $("closePasswordModal")?.addEventListener("click", closePasswordModal);

  $("cancelPasswordModal")?.addEventListener("click", closePasswordModal);

  passwordModal?.addEventListener("click", (event) => {
    if (event.target === passwordModal) {
      closePasswordModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && passwordModal?.classList.contains("show")) {
      closePasswordModal();
    }
  });

  // Submit password change

  passwordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const currentPassword = $("currentPassword")?.value || "";
    const newPassword = $("newPassword")?.value || "";
    const confirmPassword = $("confirmPassword")?.value || "";

    if (!currentPassword || !newPassword || !confirmPassword) {
      showPasswordMessage("All password fields are required.", true);
      return;
    }

    if (newPassword.length < 8) {
      showPasswordMessage(
        "New password must contain at least 8 characters.",
        true,
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      showPasswordMessage("New password and confirmation do not match.", true);
      return;
    }

    if (currentPassword === newPassword) {
      showPasswordMessage(
        "New password must be different from the current password.",
        true,
      );
      return;
    }

    if (passwordSubmit) {
      passwordSubmit.disabled = true;
      passwordSubmit.textContent = "Updating...";
    }

    showPasswordMessage("Updating your password...");

    try {
      const result = await apiRequest("/api/profile/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });

      showPasswordMessage(result.message || "Password changed successfully.");

      passwordForm.reset();

      setTimeout(() => {
        closePasswordModal();
      }, 1500);
    } catch (error) {
      console.error("Password change error:", error);
      showPasswordMessage(error.message, true);
    } finally {
      if (passwordSubmit) {
        passwordSubmit.disabled = false;
        passwordSubmit.textContent = "Update Password";
      }
    }
  });

  // -----------------------------------------------------
  // Logout using Flask session
  // -----------------------------------------------------

  async function logout(event) {
    event.preventDefault();

    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      window.location.href = "login.html";
    }
  }

  $("profileLogout")?.addEventListener("click", logout);
  $("logoutButton")?.addEventListener("click", logout);
  // -----------------------------------------------------
  // Initialize
  // -----------------------------------------------------

  setEditMode(false);
  loadProfile();
});
