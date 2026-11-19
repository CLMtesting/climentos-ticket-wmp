"""Shared API responses and database-backed authentication decorators."""
from functools import wraps

from flask import current_app, jsonify, session
from mysql.connector import Error

from config import BACKEND_DIR, PROJECT_ROOT
from extensions import get_db_connection


def api_error(message, status):
    return jsonify({"success": False, "message": message}), status


def login_required(view):
    """Require a valid session and revalidate the account against MySQL.

    The database is the source of truth for account activation and role. This
    makes deactivation and role changes take effect on the next API request,
    including requests made with an already-issued Flask session cookie.
    """
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = session.get("user")
        if not user or not user.get("id"):
            return api_error("Authentication required. Please sign in.", 401)

        conn = cursor = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT u.id, u.full_name, u.email, u.is_active,
                       r.role_name AS role, u.department_id
                FROM users AS u
                INNER JOIN roles AS r ON r.id = u.role_id
                WHERE u.id = %s
                LIMIT 1
                """,
                (user["id"],),
            )
            account = cursor.fetchone()

            if not account or not account["is_active"]:
                session.clear()
                return api_error(
                    "Your account is inactive or unavailable. Please contact your administrator.",
                    401,
                )

            # Refresh identity and authorization data so role changes take
            # effect immediately without requiring another login.
            session["user"] = {
                "id": account["id"],
                "name": account["full_name"],
                "email": account["email"],
                "role": str(account["role"]).strip().upper(),
                "department_id": account["department_id"],
            }
        except Error:
            current_app.logger.exception("Session account validation failed")
            # Fail closed when account status cannot be verified.
            return api_error(
                "Unable to verify your account. Please try again shortly.",
                503,
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

        return view(*args, **kwargs)
    return wrapped


def roles_required(*allowed_roles):
    allowed = {str(role).strip().upper() for role in allowed_roles}

    def decorator(view):
        @wraps(view)
        @login_required
        def wrapped(*args, **kwargs):
            current_role = str(session.get("user", {}).get("role", "")).upper()
            if current_role not in allowed:
                return api_error("You do not have permission to access this resource.", 403)
            return view(*args, **kwargs)
        return wrapped
    return decorator
