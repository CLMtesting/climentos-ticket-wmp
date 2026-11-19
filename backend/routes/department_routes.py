from flask import Blueprint, current_app, jsonify, redirect, request, session
from mysql.connector import Error
from datetime import datetime, timedelta
from pathlib import Path
import os
import uuid
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from common import get_db_connection, api_error, login_required, roles_required, BACKEND_DIR

DEPARTMENT_ROUTES_BP = Blueprint("department_routes", __name__)
bp = DEPARTMENT_ROUTES_BP

@bp.get("/api/departments")
def get_departments():

    conn = None
    cursor = None

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Inspect actual department columns instead of
        # assuming a particular display-name column.
        cursor.execute("""
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'departments'
        """)

        columns = {
            row["COLUMN_NAME"]
            for row in cursor.fetchall()
        }

        if "id" not in columns:
            return api_error(
                "Departments table does not contain an id column.",
                500
            )

        name_column = next(
            (
                column for column in (
                    "department_name",
                    "name",
                    "title"
                )
                if column in columns
            ),
            None
        )

        if not name_column:
            return api_error(
                "Could not identify the department name column.",
                500
            )

        active_filter = ""

        if "is_active" in columns:
            active_filter = "WHERE is_active = TRUE"

        # Column name is selected only from the fixed whitelist above.
        query = f"""
            SELECT id, `{name_column}` AS department_name
            FROM departments
            {active_filter}
            ORDER BY `{name_column}`
        """

        cursor.execute(query)
        departments = cursor.fetchall()

        return jsonify({
            "success": True,
            "departments": departments
        }), 200

    except Error:
        current_app.logger.exception("Department retrieval failed")

        return api_error(
            "Unable to load departments.",
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


@bp.get("/api/admin/departments")
@roles_required("ADMIN")
def admin_list_departments():
    """Return live department data and counts from the existing schema."""
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT
                d.id,
                d.department_name,
                d.description,
                d.is_active,
                d.created_at,
                COUNT(DISTINCT u.id) AS member_count,
                COUNT(DISTINCT tm.manager_id) AS assigned_manager_count,
                GROUP_CONCAT(DISTINCT manager.full_name ORDER BY manager.full_name SEPARATOR ', ') AS managers
            FROM departments d
            LEFT JOIN users u ON u.department_id = d.id
            LEFT JOIN teams tm ON tm.department_id = d.id AND tm.is_active = TRUE AND tm.manager_id IS NOT NULL
            LEFT JOIN users manager ON manager.id = tm.manager_id AND manager.is_active = TRUE
            GROUP BY d.id, d.department_name, d.description, d.is_active, d.created_at
            ORDER BY d.department_name
        """)
        departments = cursor.fetchall()
        for item in departments:
            item["is_active"] = bool(item["is_active"])
            item["created_at"] = item["created_at"].isoformat() if item["created_at"] else None
            item["managers"] = item["managers"] or "Not assigned through teams"
        stats = {
            "total": len(departments),
            "active": sum(1 for d in departments if d["is_active"]),
            "members": sum(int(d["member_count"] or 0) for d in departments),
            "assigned_managers": sum(int(d["assigned_manager_count"] or 0) for d in departments)
        }
        return jsonify({"success": True, "departments": departments, "stats": stats}), 200
    except Error:
        current_app.logger.exception("Admin department listing failed")
        return api_error("Unable to load department management data.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error:
                current_app.logger.warning("Could not close department listing connection.")


@bp.post("/api/admin/departments")
@roles_required("ADMIN")
def admin_create_department():
    data = request.get_json(silent=True) or {}
    name = str(data.get("department_name", "")).strip()
    description = str(data.get("description", "")).strip() or None
    if not name or len(name) > 100:
        return api_error("Department name is required and must be at most 100 characters.", 400)
    if description and len(description) > 500:
        return api_error("Description must be at most 500 characters.", 400)
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO departments (department_name, description, is_active) VALUES (%s, %s, TRUE)", (name, description))
        conn.commit()
        return jsonify({"success": True, "message": "Department created successfully.", "department_id": cursor.lastrowid}), 201
    except Error as exc:
        if conn: conn.rollback()
        if getattr(exc, "errno", None) == 1062:
            return api_error("A department with this name already exists.", 409)
        current_app.logger.exception("Department creation failed")
        return api_error("Unable to create department.", 500)
    finally:
        if cursor: cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error: pass


@bp.put("/api/admin/departments/<int:department_id>")
@roles_required("ADMIN")
def admin_update_department(department_id):
    data = request.get_json(silent=True) or {}
    name = str(data.get("department_name", "")).strip()
    description = str(data.get("description", "")).strip() or None
    is_active = data.get("is_active", True)
    if not isinstance(is_active, bool):
        return api_error("is_active must be true or false.", 400)
    if not name or len(name) > 100:
        return api_error("Department name is required and must be at most 100 characters.", 400)
    if description and len(description) > 500:
        return api_error("Description must be at most 500 characters.", 400)
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE departments SET department_name=%s, description=%s, is_active=%s WHERE id=%s", (name, description, is_active, department_id))
        if cursor.rowcount == 0:
            cursor.execute("SELECT id FROM departments WHERE id=%s", (department_id,))
            if not cursor.fetchone(): return api_error("Department not found.", 404)
        conn.commit()
        return jsonify({"success": True, "message": "Department updated successfully."}), 200
    except Error as exc:
        if conn: conn.rollback()
        if getattr(exc, "errno", None) == 1062:
            return api_error("A department with this name already exists.", 409)
        current_app.logger.exception("Department update failed")
        return api_error("Unable to update department.", 500)
    finally:
        if cursor: cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error: pass


@bp.patch("/api/admin/departments/<int:department_id>/status")
@roles_required("ADMIN")
def admin_update_department_status(department_id):
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get("is_active"), bool):
        return api_error("is_active must be true or false.", 400)
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE departments SET is_active=%s WHERE id=%s", (data["is_active"], department_id))
        if cursor.rowcount == 0:
            cursor.execute("SELECT id FROM departments WHERE id=%s", (department_id,))
            if not cursor.fetchone(): return api_error("Department not found.", 404)
        conn.commit()
        return jsonify({"success": True, "message": "Department status updated successfully."}), 200
    except Error:
        if conn: conn.rollback()
        current_app.logger.exception("Department status update failed")
        return api_error("Unable to update department status.", 500)
    finally:
        if cursor: cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error: pass

