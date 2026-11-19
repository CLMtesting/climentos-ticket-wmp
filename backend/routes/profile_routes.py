
from flask import Blueprint, current_app, jsonify, request, session
from mysql.connector import Error
from werkzeug.security import check_password_hash, generate_password_hash
from common import get_db_connection, api_error, login_required
import re

PROFILE_ROUTES_BP = Blueprint("profile_routes", __name__)


def get_profile_data(cursor, user_id):
    cursor.execute("""
        SELECT
            u.id,
            u.full_name,
            u.email,
            u.phone,
            u.profile_image,
            u.is_active,
            u.created_at,
            r.role_name AS role,
            d.department_name AS department,
            m.full_name AS manager_name
        FROM users u
        INNER JOIN roles r ON r.id = u.role_id
        LEFT JOIN departments d ON d.id = u.department_id
        LEFT JOIN users m ON m.id = u.manager_id
        WHERE u.id = %s
        LIMIT 1
    """, (user_id,))

    user = cursor.fetchone()

    if not user:
        return None

    created_at = user.get("created_at")
    joined_date = (
        created_at.strftime("%d %b %Y")
        if created_at else None
    )

    role = str(user["role"]).upper()

    return {
        "id": user["id"],
        "employee_id": f"CLM-{role[:3]}-{user['id']:03d}",
        "name": user["full_name"],
        "email": user["email"],
        "phone": user.get("phone") or "",
        "role": role,
        "department": user.get("department") or "Not assigned",
        "manager": user.get("manager_name") or "Not assigned",
        "is_active": bool(user["is_active"]),
        "joined_date": joined_date,
        "profile_image": user.get("profile_image")
    }


@PROFILE_ROUTES_BP.get("/api/profile")
@login_required
def get_my_profile():
    conn = None
    cursor = None

    try:
        user_id = session["user"]["id"]

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        profile = get_profile_data(cursor, user_id)

        if not profile:
            return api_error("User profile not found.", 404)

        return jsonify({
            "success": True,
            "profile": profile
        }), 200

    except Error:
        current_app.logger.exception("Profile retrieval failed")
        return api_error("Unable to load your profile.", 500)

    finally:
        if cursor:
            cursor.close()
        if conn and conn.is_connected():
            conn.close()


@PROFILE_ROUTES_BP.put("/api/profile")
@login_required
def update_my_profile():
    data = request.get_json(silent=True) or {}

    full_name = str(data.get("full_name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    phone = str(data.get("phone", "")).strip()

    if not full_name or not email:
        return api_error("Full name and email are required.", 400)

    if len(full_name) < 2 or len(full_name) > 120:
        return api_error("Full name must be between 2 and 120 characters.", 400)

    if len(email) > 190 or not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+", email
    ):
        return api_error("Enter a valid email address.", 400)

    if len(phone) > 25:
        return api_error("Phone number cannot exceed 25 characters.", 400)

    conn = None
    cursor = None

    try:
        user_id = session["user"]["id"]

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT id
            FROM users
            WHERE email = %s AND id != %s
            LIMIT 1
        """, (email, user_id))

        if cursor.fetchone():
            return api_error("This email address is already in use.", 409)

        cursor.execute("""
            UPDATE users
            SET full_name = %s,
                email = %s,
                phone = %s
            WHERE id = %s
        """, (full_name, email, phone or None, user_id))

        conn.commit()

        # Keep the current Flask session identity in sync.
        session_user = dict(session["user"])
        session_user["name"] = full_name
        session_user["email"] = email
        session["user"] = session_user

        profile = get_profile_data(cursor, user_id)

        return jsonify({
            "success": True,
            "message": "Profile updated successfully.",
            "profile": profile
        }), 200

    except Error as exc:
        if conn:
            conn.rollback()

        if getattr(exc, "errno", None) == 1062:
            return api_error("This email address is already in use.", 409)

        current_app.logger.exception("Profile update failed")
        return api_error("Unable to update your profile.", 500)

    finally:
        if cursor:
            cursor.close()
        if conn and conn.is_connected():
            conn.close()


@PROFILE_ROUTES_BP.post("/api/profile/change-password")
@login_required
def change_my_password():
    data = request.get_json(silent=True) or {}

    current_password = str(data.get("current_password", ""))
    new_password = str(data.get("new_password", ""))
    confirm_password = str(data.get("confirm_password", ""))

    if not current_password or not new_password or not confirm_password:
        return api_error("All password fields are required.", 400)

    if len(new_password) < 8:
        return api_error("New password must contain at least 8 characters.", 400)

    if new_password != confirm_password:
        return api_error("New password and confirmation do not match.", 400)

    if current_password == new_password:
        return api_error("New password must be different from the current password.", 400)

    conn = None
    cursor = None

    try:
        user_id = session["user"]["id"]

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT password_hash
            FROM users
            WHERE id = %s
            LIMIT 1
        """, (user_id,))

        account = cursor.fetchone()

        if not account:
            return api_error("User account not found.", 404)

        if not check_password_hash(account["password_hash"], current_password):
            return api_error("Current password is incorrect.", 401)

        new_hash = generate_password_hash(new_password)

        cursor.execute("""
            UPDATE users
            SET password_hash = %s
            WHERE id = %s
        """, (new_hash, user_id))

        conn.commit()

        return jsonify({
            "success": True,
            "message": "Password changed successfully."
        }), 200

    except (Error, ValueError, TypeError):
        if conn:
            conn.rollback()

        current_app.logger.exception("Password change failed")
        return api_error("Unable to change your password.", 500)

    finally:
        if cursor:
            cursor.close()
        if conn and conn.is_connected():
            conn.close()
