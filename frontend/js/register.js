/* CLIMENTOS WMP - DATABASE-DRIVEN EMPLOYEE REGISTRATION */
document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");
  const form = document.getElementById("registerForm");
  const message = document.getElementById("formMessage");
  const button = document.getElementById("registerButton");
  const buttonText = document.getElementById("registerButtonText");

  const fields = {
    fullName: document.getElementById("fullName"),
    email: document.getElementById("email"),
    department: document.getElementById("department"),
    password: document.getElementById("password"),
    confirmPassword: document.getElementById("confirmPassword"),
  };

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
  } catch (_) {}
  applyTheme(savedTheme);

  themeToggle?.addEventListener("click", () => {
    const next = document.body.classList.contains("dark-theme")
      ? "light"
      : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("climentos-theme", next);
    } catch (_) {}
  });

  document.querySelectorAll("[data-toggle]").forEach((toggle) =>
    toggle.addEventListener("click", () => {
      const input = document.getElementById(toggle.dataset.toggle);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.textContent = show ? "Hide" : "Show";
      toggle.setAttribute(
        "aria-label",
        show ? "Hide password" : "Show password",
      );
    }),
  );

  function setError(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function clearErrors() {
    [
      "fullNameError",
      "emailError",
      "departmentError",
      "passwordError",
      "confirmPasswordError",
      "termsError",
    ].forEach((id) => setError(id, ""));
    if (message) {
      message.textContent = "";
      message.className = "form-message";
    }
  }

  Object.entries(fields).forEach(([key, input]) => {
    input?.addEventListener("input", () => setError(`${key}Error`, ""));
    input?.addEventListener("change", () => setError(`${key}Error`, ""));
  });

  async function loadDepartments() {
    const select = fields.department;
    if (!select) return;
    select.innerHTML = '<option value="">Loading departments...</option>';
    select.disabled = true;

    try {
      const response = await fetch("/api/departments", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load departments.");
      }

      select.innerHTML = '<option value="">Select department</option>';
      (result.departments || []).forEach((department) => {
        const option = document.createElement("option");
        option.value = department.id;
        option.textContent = department.department_name;
        select.appendChild(option);
      });

      if (!result.departments || result.departments.length === 0) {
        select.innerHTML =
          '<option value="">No active departments available</option>';
        setError(
          "departmentError",
          "No active departments are currently available.",
        );
      }
    } catch (error) {
      select.innerHTML = '<option value="">Unable to load departments</option>';
      setError("departmentError", error.message);
    } finally {
      select.disabled = false;
    }
  }

  loadDepartments();

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();

    const values = {
      fullName: fields.fullName.value.trim(),
      email: fields.email.value.trim().toLowerCase(),
      departmentId: fields.department.value,
      password: fields.password.value,
      confirmPassword: fields.confirmPassword.value,
    };

    let valid = true;

    if (values.fullName.length < 2 || values.fullName.length > 120) {
      setError("fullNameError", "Enter your full name (2–120 characters).");
      valid = false;
    }
    if (!values.email) {
      setError("emailError", "Please enter your work email.");
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      setError("emailError", "Please enter a valid email address.");
      valid = false;
    }
    if (!values.departmentId) {
      setError("departmentError", "Please select your department.");
      valid = false;
    }
    if (values.password.length < 8) {
      setError("passwordError", "Use at least 8 characters.");
      valid = false;
    }
    if (!values.confirmPassword) {
      setError("confirmPasswordError", "Please confirm your password.");
      valid = false;
    } else if (values.password !== values.confirmPassword) {
      setError("confirmPasswordError", "Passwords do not match.");
      valid = false;
    }
    if (!document.getElementById("termsAccepted")?.checked) {
      setError("termsError", "Please accept the workspace terms to continue.");
      valid = false;
    }
    if (!valid) return;

    button.disabled = true;
    if (buttonText) buttonText.textContent = "Creating account...";
    if (message) {
      message.textContent = "Submitting your details...";
      message.className = "form-message";
    }

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          fullName: values.fullName,
          email: values.email,
          password: values.password,
          departmentId: Number(values.departmentId),
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to create your account.");
      }

      if (message) {
        message.textContent =
          result.message || "Account created successfully. Please sign in.";
        message.className = "form-message success";
      }

      form.reset();
      await loadDepartments();

      window.setTimeout(() => {
        window.location.href = "login.html";
      }, 1500);
    } catch (error) {
      if (message) {
        message.textContent =
          error.message || "Registration failed. Please try again.";
        message.className = "form-message error";
      }
    } finally {
      button.disabled = false;
      if (buttonText) buttonText.textContent = "Create employee account";
    }
  });
});
