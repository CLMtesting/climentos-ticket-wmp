from flask import Blueprint, current_app, jsonify, redirect, request, session
from mysql.connector import Error
from datetime import datetime, timedelta
from pathlib import Path
import os
import uuid
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from common import get_db_connection, api_error, login_required, roles_required, BACKEND_DIR

USER_ROUTES_BP = Blueprint("user_routes", __name__)
bp = USER_ROUTES_BP

@bp.get("/api/admin/users")
@roles_required("ADMIN")
def admin_list_users():
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT u.id, u.full_name, u.email, u.role_id, r.role_name AS role,
                   u.department_id, d.department_name,
                   u.manager_id, manager.full_name AS manager_name,
                   u.phone, u.job_title, u.is_active, u.created_at
            FROM users u
            INNER JOIN roles r ON r.id = u.role_id
            LEFT JOIN departments d ON d.id = u.department_id
            LEFT JOIN users manager ON manager.id = u.manager_id
            ORDER BY u.created_at DESC, u.id DESC
        """)
        users = cursor.fetchall()
        for user in users:
            user["employee_code"] = _user_display_code(user["role"], user["id"])
            user["is_active"] = bool(user["is_active"])
            if user.get("created_at"):
                user["created_at"] = user["created_at"].isoformat(sep=" ")
        cursor.execute("""
            SELECT id, department_name FROM departments
            WHERE is_active = TRUE ORDER BY department_name
        """)
        departments = cursor.fetchall()
        cursor.execute("""
            SELECT u.id, u.full_name, u.department_id
            FROM users u INNER JOIN roles r ON r.id = u.role_id
            WHERE r.role_name = 'MANAGER' AND u.is_active = TRUE
            ORDER BY u.full_name
        """)
        managers = cursor.fetchall()
        return jsonify({"success": True, "users": users,
                        "departments": departments, "managers": managers}), 200
    except Error:
        current_app.logger.exception("Admin user list retrieval failed")
        return api_error("Unable to load users from the database.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error:
                pass


@bp.post("/api/admin/users")
@roles_required("ADMIN")
def admin_create_user():
    conn = cursor = None
    try:
        data = request.get_json(silent=True) or {}
        full_name = str(data.get("full_name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        role = str(data.get("role", "EMPLOYEE")).strip().upper()
        department_id = data.get("department_id") or None
        manager_id = data.get("manager_id") or None
        phone = str(data.get("phone", "")).strip() or None
        job_title = str(data.get("job_title", "")).strip() or None
        actor_id = int(session["user"]["id"])

        if not full_name or len(full_name) > 120:
            return api_error("Full name is required (maximum 120 characters).", 400)
        if not email or len(email) > 190 or "@" not in email:
            return api_error("Enter a valid email address.", 400)
        if len(password) < 8:
            return api_error("Password must contain at least 8 characters.", 400)
        if role not in {"EMPLOYEE", "MANAGER"}:
            return api_error("Admin can create Employee or Manager accounts only.", 400)

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id FROM roles WHERE role_name=%s", (role,))
        role_row = cursor.fetchone()
        if not role_row:
            return api_error(f"Role {role} is not configured in the database.", 400)

        if department_id:
            cursor.execute(
                "SELECT id FROM departments WHERE id=%s AND is_active=TRUE",
                (department_id,),
            )
            if not cursor.fetchone():
                return api_error("Selected department is invalid or inactive.", 400)

        if role == "MANAGER":
            # The authenticated Admin is the organization head; every newly
            # created Manager reports directly to that Admin.
            manager_id = actor_id
        elif manager_id:
            cursor.execute(
                """
                SELECT u.id FROM users AS u
                INNER JOIN roles AS r ON r.id = u.role_id
                WHERE u.id=%s AND r.role_name='MANAGER' AND u.is_active=TRUE
                LIMIT 1
                """,
                (manager_id,),
            )
            if not cursor.fetchone():
                return api_error("Selected reporting manager is invalid or inactive.", 400)

        cursor.execute("""
            INSERT INTO users
                (full_name, email, password_hash, role_id, department_id,
                 manager_id, phone, job_title, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
        """, (
            full_name, email, generate_password_hash(password), role_row["id"],
            department_id, manager_id, phone, job_title,
        ))
        user_id = cursor.lastrowid
        conn.commit()
        return jsonify({
            "success": True,
            "message": "User account created successfully.",
            "user_id": user_id,
            "employee_code": _user_display_code(role, user_id),
        }), 201
    except Error as exc:
        if conn:
            conn.rollback()
        if getattr(exc, "errno", None) == 1062:
            return api_error("This email address is already registered.", 409)
        current_app.logger.exception("Admin user creation failed")
        return api_error("Unable to create user account.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


@bp.put("/api/admin/users/<int:user_id>")
@roles_required("ADMIN")
def admin_update_user(user_id):
    conn = cursor = None
    try:
        data = request.get_json(silent=True) or {}
        full_name = str(data.get("full_name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        role = str(data.get("role", "")).strip().upper()
        department_id = data.get("department_id") or None
        manager_id = data.get("manager_id") or None
        phone = str(data.get("phone", "")).strip() or None
        job_title = str(data.get("job_title", "")).strip() or None
        password = str(data.get("password", ""))
        actor_id = int(session["user"]["id"])

        if not full_name or len(full_name) > 120 or not email or len(email) > 190 or "@" not in email:
            return api_error("Enter a valid name and email address.", 400)
        if role not in {"EMPLOYEE", "MANAGER", "ADMIN"}:
            return api_error("Select a valid role.", 400)
        if password and len(password) < 8:
            return api_error("Password must contain at least 8 characters.", 400)

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        # Lock active Admin rows first in a stable order before any possible
        # demotion, avoiding concurrent requests bypassing the last-Admin guard.
        active_admin_ids = _lock_active_admin_ids(cursor) if role != "ADMIN" else []
        cursor.execute("""
            SELECT u.id, u.is_active, r.role_name AS role
            FROM users AS u
            INNER JOIN roles AS r ON r.id = u.role_id
            WHERE u.id=%s
            FOR UPDATE
        """, (user_id,))
        existing = cursor.fetchone()
        if not existing:
            return api_error("User not found.", 404)

        # Lock the active Admin rows before a possible demotion. This protects
        # the last active Admin from concurrent role changes as well.
        if existing["role"] == "ADMIN" and existing["is_active"] and role != "ADMIN":
            if len(active_admin_ids) <= 1 and user_id in active_admin_ids:
                conn.rollback()
                return api_error("The last active Admin cannot be demoted.", 400)

        if department_id:
            cursor.execute(
                "SELECT id FROM departments WHERE id=%s AND is_active=TRUE",
                (department_id,),
            )
            if not cursor.fetchone():
                conn.rollback()
                return api_error("Selected department is invalid or inactive.", 400)

        if role == "MANAGER":
            # Managers report directly to the Admin performing this change.
            manager_id = actor_id
        elif role == "ADMIN":
            # Admin is the organization head and has no reporting manager.
            manager_id = None
        elif manager_id:
            cursor.execute("""
                SELECT u.id
                FROM users AS u
                INNER JOIN roles AS r ON r.id = u.role_id
                WHERE u.id=%s AND r.role_name='MANAGER' AND u.is_active=TRUE
                LIMIT 1
            """, (manager_id,))
            if not cursor.fetchone():
                conn.rollback()
                return api_error("Employees can report only to an active Manager.", 400)

        cursor.execute("SELECT id FROM roles WHERE role_name=%s", (role,))
        role_row = cursor.fetchone()
        if not role_row:
            conn.rollback()
            return api_error("Selected role is not configured.", 400)

        if password:
            cursor.execute("""
                UPDATE users
                SET full_name=%s, email=%s, role_id=%s, department_id=%s,
                    manager_id=%s, phone=%s, job_title=%s, password_hash=%s
                WHERE id=%s
            """, (
                full_name, email, role_row["id"], department_id, manager_id,
                phone, job_title, generate_password_hash(password), user_id,
            ))
        else:
            cursor.execute("""
                UPDATE users
                SET full_name=%s, email=%s, role_id=%s, department_id=%s,
                    manager_id=%s, phone=%s, job_title=%s
                WHERE id=%s
            """, (
                full_name, email, role_row["id"], department_id, manager_id,
                phone, job_title, user_id,
            ))
        conn.commit()
        return jsonify({"success": True, "message": "User details updated successfully."}), 200
    except Error as exc:
        if conn:
            conn.rollback()
        if getattr(exc, "errno", None) == 1062:
            return api_error("This email address is already registered.", 409)
        current_app.logger.exception("Admin user update failed")
        return api_error("Unable to update user details.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


@bp.patch("/api/admin/users/<int:user_id>/status")
@roles_required("ADMIN")
def admin_update_user_status(user_id):
    conn = cursor = None
    try:
        current_id = int(session["user"]["id"])
        data = request.get_json(silent=True) or {}
        is_active = data.get("is_active")
        if not isinstance(is_active, bool):
            return api_error("is_active must be true or false.", 400)
        if user_id == current_id and not is_active:
            return api_error("You cannot deactivate your own account.", 400)

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        # For deactivation, lock active Admin rows before the target row so
        # simultaneous deactivation requests cannot remove the final Admin.
        active_admin_ids = _lock_active_admin_ids(cursor) if not is_active else []
        cursor.execute("""
            SELECT u.id, u.is_active, r.role_name AS role
            FROM users AS u
            INNER JOIN roles AS r ON r.id = u.role_id
            WHERE u.id=%s
            FOR UPDATE
        """, (user_id,))
        target = cursor.fetchone()
        if not target:
            conn.rollback()
            return api_error("User not found.", 404)

        if target["role"] == "ADMIN" and target["is_active"] and not is_active:
            if len(active_admin_ids) <= 1 and user_id in active_admin_ids:
                conn.rollback()
                return api_error("The last active Admin cannot be deactivated.", 400)

        cursor.execute("UPDATE users SET is_active=%s WHERE id=%s", (is_active, user_id))
        conn.commit()
        return jsonify({
            "success": True,
            "message": "User account activated." if is_active else "User account deactivated.",
        }), 200
    except Error:
        if conn:
            conn.rollback()
        current_app.logger.exception("Admin user status update failed")
        return api_error("Unable to update account status.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


def _lock_active_admin_ids(cursor):
    """Return and lock active Admin rows in a stable order."""
    cursor.execute("""
        SELECT u.id
        FROM users AS u
        INNER JOIN roles AS r ON r.id = u.role_id
        WHERE r.role_name='ADMIN' AND u.is_active=TRUE
        ORDER BY u.id
        FOR UPDATE
    """)
    return [int(row["id"]) for row in cursor.fetchall()]


def _user_display_code(role, user_id):
    prefixes = {"EMPLOYEE": "EMP", "MANAGER": "MGR", "ADMIN": "ADM"}
    return f"CLM-{prefixes.get(str(role).upper(), 'USR')}-{int(user_id):03d}"

