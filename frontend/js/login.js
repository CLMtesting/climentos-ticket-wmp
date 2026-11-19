/* CLIMENTOS WORK MANAGEMENT PLATFORM - LOGIN PAGE */
document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");
  const passwordToggle = document.getElementById("passwordToggle");
  const passwordInput = document.getElementById("password");
  const loginForm = document.getElementById("loginForm");
  const loginButton = document.getElementById("loginButton");
  const buttonText = document.getElementById("buttonText");
  const emailInput = document.getElementById("email");
  const rolePicker = document.getElementById("rolePicker");
  const rolePickerTrigger = document.getElementById("rolePickerTrigger");
  const rolePickerMenu = document.getElementById("rolePickerMenu");
  const rolePickerCurrent = document.getElementById("rolePickerCurrent");
  const emailError = document.getElementById("emailError");
  const passwordError = document.getElementById("passwordError");
  const formMessage = document.getElementById("formMessage");
  const forgotLink = document.getElementById("forgotLink");
  const accessLink = document.getElementById("accessLink");

  let selectedRole = "EMPLOYEE";
  let availableRoles = [];
  let rolesLoaded = false;

  function applyTheme(theme) {
    document.body.classList.toggle("dark-theme", theme === "dark");
    if (themeIcon) themeIcon.textContent = theme === "dark" ? "☀" : "☾";
    themeToggle?.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
    );
  }

  let savedTheme = "light";
  try {
    savedTheme = localStorage.getItem("climentos-theme") || "light";
  } catch (error) {
    console.warn("Theme storage unavailable.");
  }
  applyTheme(savedTheme);

  themeToggle?.addEventListener("click", () => {
    const next = document.body.classList.contains("dark-theme")
      ? "light"
      : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("climentos-theme", next);
    } catch (error) {
      console.warn("Could not save theme.");
    }
  });

  passwordToggle?.addEventListener("click", () => {
    if (!passwordInput) return;
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    passwordToggle.textContent = show ? "Hide" : "Show";
    passwordToggle.setAttribute(
      "aria-label",
      show ? "Hide password" : "Show password",
    );
  });

  function showError(element, message) {
    if (element) element.textContent = message;
  }

  function clearErrors() {
    showError(emailError, "");
    showError(passwordError, "");
    if (formMessage) {
      formMessage.textContent = "";
      formMessage.className = "form-message";
    }
  }

  function showMessage(message, type = "") {
    if (!formMessage) return;
    formMessage.textContent = message;
    formMessage.className = type ? `form-message ${type}` : "form-message";
  }

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function roleLabel(role) {
    return role.charAt(0) + role.slice(1).toLowerCase();
  }

  function closeRoleMenu() {
    if (!rolePickerMenu || !rolePickerTrigger) return;
    rolePickerMenu.hidden = true;
    rolePickerTrigger.setAttribute("aria-expanded", "false");
  }

  function selectRole(role) {
    selectedRole = role;
    if (rolePickerCurrent) rolePickerCurrent.textContent = roleLabel(role);
    rolePickerMenu
      ?.querySelectorAll(".role-picker-option")
      .forEach((option) => {
        const active = option.dataset.role === selectedRole;
        option.classList.toggle("selected", active);
        option.setAttribute("aria-pressed", String(active));
      });
    closeRoleMenu();
    if (formMessage) formMessage.textContent = "";
  }

  function renderRoles(roles) {
    if (!rolePickerMenu)
      throw new Error("The role selector was not found on the login page.");

    const allowedRoles = ["EMPLOYEE", "MANAGER", "ADMIN"];
    const normalizedRoles = roles
      .map((item) =>
        String(item.role_name || item.role || "")
          .trim()
          .toUpperCase(),
      )
      .filter((role) => allowedRoles.includes(role));

    availableRoles = allowedRoles.filter((role) =>
      normalizedRoles.includes(role),
    );
    if (!availableRoles.length)
      throw new Error("No valid account roles were returned by the server.");

    rolePickerMenu.replaceChildren();
    const roleIcons = { EMPLOYEE: "♙", MANAGER: "♧", ADMIN: "⚙" };

    availableRoles.forEach((role) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "role-picker-option";
      option.dataset.role = role;
      option.setAttribute("aria-pressed", "false");

      const icon = document.createElement("span");
      icon.className = "role-option-icon";
      icon.textContent = roleIcons[role];

      const label = document.createElement("span");
      label.textContent = roleLabel(role);

      const check = document.createElement("span");
      check.className = "role-option-check";
      check.textContent = "✓";

      option.append(icon, label, check);
      option.addEventListener("click", () => selectRole(role));
      rolePickerMenu.appendChild(option);
    });

    selectRole(
      availableRoles.includes("EMPLOYEE") ? "EMPLOYEE" : availableRoles[0],
    );
    rolesLoaded = true;
    if (loginButton) loginButton.disabled = false;
  }

  async function loadRoles() {
    if (loginButton) loginButton.disabled = true;
    if (rolePickerCurrent) rolePickerCurrent.textContent = "Loading...";
    try {
      if (typeof getRoles !== "function") {
        throw new Error(
          "The API helper did not load. Check the api.js script path.",
        );
      }
      const result = await getRoles();
      const roles = Array.isArray(result)
        ? result
        : result.roles || result.data || [];
      if (!Array.isArray(roles))
        throw new Error("The roles response has an unexpected format.");
      renderRoles(roles);
    } catch (error) {
      console.error("Could not load account roles:", error);
      if (rolePickerCurrent) rolePickerCurrent.textContent = "Unavailable";
      showMessage(
        error.message || "Unable to load account roles. Refresh and try again.",
        "error",
      );
      rolesLoaded = false;
      if (loginButton) loginButton.disabled = true;
    }
  }

  rolePickerTrigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!rolesLoaded || !rolePickerMenu) return;
    const shouldOpen = rolePickerMenu.hidden;
    rolePickerMenu.hidden = !shouldOpen;
    rolePickerTrigger.setAttribute("aria-expanded", String(shouldOpen));
  });

  document.addEventListener("click", (event) => {
    if (rolePicker && !rolePicker.contains(event.target)) closeRoleMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRoleMenu();
  });

  emailInput?.addEventListener("input", () => {
    showError(emailError, "");
    if (formMessage) formMessage.textContent = "";
  });
  passwordInput?.addEventListener("input", () => {
    showError(passwordError, "");
    if (formMessage) formMessage.textContent = "";
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();

    const email = emailInput?.value.trim() || "";
    const password = passwordInput?.value || "";
    let valid = true;

    if (!email) {
      showError(emailError, "Please enter your work email.");
      valid = false;
    } else if (!validEmail(email)) {
      showError(emailError, "Please enter a valid email address.");
      valid = false;
    }
    if (!password.trim()) {
      showError(passwordError, "Please enter your password.");
      valid = false;
    }
    if (!valid) return;

    if (!rolesLoaded || !availableRoles.includes(selectedRole)) {
      showMessage(
        "Account roles are not available. Refresh the page and try again.",
        "error",
      );
      return;
    }

    if (loginButton) loginButton.disabled = true;
    if (buttonText) buttonText.textContent = "Signing in...";
    showMessage("");

    try {
      if (typeof loginUser !== "function")
        throw new Error(
          "The API helper did not load. Check the api.js script path.",
        );

      // Flask owns authentication. The browser keeps the session cookie;
      // authenticated user and role details are not copied into localStorage.
      const result = await loginUser({ email, password, selectedRole });
      if (!result.success) {
        showMessage(
          result.message || "Invalid email, password, or role.",
          "error",
        );
        return;
      }

      showMessage("Login successful! Opening your workspace...", "success");
      window.location.href = result.redirect || "/pages/dashboard.html";
    } catch (error) {
      console.error("Login API error:", error);
      showMessage(
        error.message ||
          "Unable to connect to the server. Please start Flask and try again.",
        "error",
      );
    } finally {
      if (loginButton) loginButton.disabled = !rolesLoaded;
      if (buttonText) buttonText.textContent = "Sign in to workspace";
    }
  });

  forgotLink?.addEventListener("click", (event) => {
    event.preventDefault();
    showMessage(
      "Password recovery will be available in a later development phase.",
    );
  });
  accessLink?.addEventListener("click", (event) => {
    event.preventDefault();
    showMessage("Please contact your company administrator to request access.");
  });

  loadRoles();
});
