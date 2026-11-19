from flask import Blueprint, current_app, jsonify, redirect, request, session
from mysql.connector import Error
from datetime import datetime, timedelta
from pathlib import Path
import os
import uuid
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from common import get_db_connection, api_error, login_required, roles_required, BACKEND_DIR

AUTH_ROUTES_BP = Blueprint("auth_routes", __name__)
bp = AUTH_ROUTES_BP

@bp.get("/api/health")
def health():

    conn = None
    cursor = None

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT DATABASE()")
        database_name = cursor.fetchone()[0]

        return jsonify({
            "success": True,
            "message": "Backend and database connection are healthy.",
            "database": database_name
        }), 200

    except (Error, ValueError):
        current_app.logger.exception("Database health check failed")

        return api_error(
            "Database connection failed. Check backend/.env and MySQL.",
            503
        )

    finally:
        if cursor:
            cursor.close()

        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                current_app.logger.warning("Error while closing a MySQL connection.")


@bp.get("/api/roles")
def get_roles():

    conn = None
    cursor = None

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT id, role_name
            FROM roles
            ORDER BY id
        """)

        roles = cursor.fetchall()

        return jsonify({
            "success": True,
            "roles": roles
        }), 200

    except Error:
        current_app.logger.exception("Role retrieval failed")

        return api_error(
            "Unable to load roles.",
            500
        )

    finally:
        if cursor:
            cursor.close()

        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                current_app.logger.warning("Error while closing a MySQL connection.")


@bp.post("/api/login")
def login():

    data = request.get_json(silent=True) or {}

    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    selected_role = str(
        data.get("selectedRole", "")
    ).strip().upper()

    if not email or not password or not selected_role:
        return api_error(
            "Email, password and account role are required.",
            400
        )

    conn = None
    cursor = None

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                u.id,
                u.full_name,
                u.email,
                u.password_hash,
                u.is_active,
                u.department_id,
                r.role_name AS role
            FROM users u
            INNER JOIN roles r
                ON r.id = u.role_id
            WHERE u.email = %s
            LIMIT 1
        """, (email,))

        account = cursor.fetchone()

        if not account:
            return api_error(
                "Invalid email or password.",
                401
            )

        if not account["is_active"]:
            return api_error(
                "Your account is inactive. Contact your administrator.",
                403
            )

        # Verify the submitted password against the stored Werkzeug hash.
        # A malformed/unsupported stored hash is treated as a failed login.
        try:
            password_is_valid = check_password_hash(
                account["password_hash"],
                password
            )
        except (TypeError, ValueError):
            current_app.logger.exception(
                "Invalid password hash stored for user id %s",
                account["id"]
            )
            password_is_valid = False

        if not password_is_valid:
            return api_error(
                "Invalid email or password.",
                401
            )

        # Validate selected role against the actual database role.
        actual_role = str(account["role"]).strip().upper()
        if selected_role != actual_role:
            return api_error(
                "The selected role does not match this account.",
                403
            )

        cursor.execute("""
            UPDATE users
            SET last_login_at = %s
            WHERE id = %s
        """, (datetime.now(), account["id"]))

        conn.commit()

        user_data = {
            "id": account["id"],
            "name": account["full_name"],
            "email": account["email"],
            "role": actual_role,
            "department_id": account["department_id"]
        }

        # Start a fresh session after successful authentication.
        session.clear()
        session.permanent = True
        session["user"] = user_data

        return jsonify({
            "success": True,
            "message": "Login successful.",
            "user": user_data,
            "redirect": "/pages/dashboard.html"
        }), 200

    except Error:
        if conn:
            conn.rollback()

        current_app.logger.exception("Login database operation failed")

        return api_error(
            "Unable to complete login because of a database error.",
            500
        )

    finally:
        if cursor:
            cursor.close()

        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                current_app.logger.warning("Error while closing a MySQL connection.")


@bp.get("/api/me")
@login_required
def current_user():

    return jsonify({
        "success": True,
        "user": session["user"]
    }), 200


@bp.post("/api/logout")
def logout():

    session.clear()

    return jsonify({
        "success": True,
        "message": "Logged out successfully."
    }), 200


@bp.post("/api/register")
def register():

    data = request.get_json(silent=True) or {}

    full_name = str(data.get("fullName", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    department_id = data.get("departmentId")

    # Validate required fields
    if not full_name or not email or not password or department_id is None:
        return api_error("All required fields are mandatory.", 400)

    if len(full_name) < 2 or len(full_name) > 120:
        return api_error("Full name must be between 2 and 120 characters.", 400)

    if len(password) < 8:
        return api_error("Password must contain at least 8 characters.", 400)

    if "@" not in email or "." not in email.split("@")[-1]:
        return api_error("Enter a valid email address.", 400)

    try:
        department_id = int(department_id)
        if department_id <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return api_error("Invalid department selected.", 400)

    conn = None
    cursor = None

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Check existing email
        cursor.execute("""
            SELECT id
            FROM users
            WHERE email = %s
            LIMIT 1
        """, (email,))

        if cursor.fetchone():
            return api_error("Email already registered.", 409)

        # Check department
        cursor.execute("""
            SELECT id
            FROM departments
            WHERE id = %s
              AND is_active = TRUE
        """, (department_id,))

        if not cursor.fetchone():
            return api_error("Selected department is unavailable.", 400)

        # Get Employee role from database
        cursor.execute("""
            SELECT id
            FROM roles
            WHERE role_name = %s
            LIMIT 1
        """, ("EMPLOYEE",))

        employee_role = cursor.fetchone()

        if not employee_role:
            return api_error("Employee role not configured.", 500)

        # Hash password
        password_hash = generate_password_hash(password)

        # Insert account into MySQL
        cursor.execute("""
            INSERT INTO users (
                full_name,
                email,
                password_hash,
                role_id,
                department_id
            )
            VALUES (%s, %s, %s, %s, %s)
        """, (
            full_name,
            email,
            password_hash,
            employee_role["id"],
            department_id
        ))

        conn.commit()

        return jsonify({
            "success": True,
            "message": "Employee account created successfully."
        }), 201

    except Error as exc:

        if conn:
            conn.rollback()

        if getattr(exc, "errno", None) == 1062:
            return api_error("Email already registered.", 409)

        current_app.logger.exception("Registration failed")
        return api_error("Unable to create employee account.", 500)

    finally:
        if cursor:
            cursor.close()

        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                current_app.logger.warning("Error while closing a MySQL connection.")



@bp.get("/api/admin/summary")
@roles_required("ADMIN")
def admin_summary():

    conn = None
    cursor = None

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT COUNT(*) AS total_users
            FROM users
        """)

        total_users = cursor.fetchone()["total_users"]

        cursor.execute("""
            SELECT COUNT(*) AS total_tickets
            FROM tickets
        """)

        total_tickets = cursor.fetchone()["total_tickets"]

        return jsonify({
            "success": True,
            "data": {
                "total_users": total_users,
                "total_tickets": total_tickets
            }
        }), 200

    except Error:
        current_app.logger.exception("Admin summary failed")

        return api_error(
            "Could not load admin summary.",
            500
        )

    finally:
        if cursor:
            cursor.close()

        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                current_app.logger.warning("Error while closing a MySQL connection.")

