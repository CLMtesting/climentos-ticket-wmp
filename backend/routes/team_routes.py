from flask import Blueprint, current_app, jsonify, redirect, request, session
from mysql.connector import Error
from datetime import datetime, timedelta
from pathlib import Path
import os
import uuid
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from common import get_db_connection, api_error, login_required, roles_required, BACKEND_DIR

TEAM_ROUTES_BP = Blueprint("team_routes", __name__)
bp = TEAM_ROUTES_BP

@bp.get("/api/team-management")
@roles_required("ADMIN", "MANAGER")
def team_management_data():
    conn = None
    cursor = None
    try:
        current = session["user"]
        role = str(current.get("role", "")).upper()
        user_id = int(current["id"])
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        if role == "ADMIN":
            cursor.execute("""
                SELECT t.id, t.team_name, t.department_id, d.department_name,
                       t.manager_id, m.full_name AS manager_name,
                       t.description, t.is_active, t.created_at,
                       COUNT(DISTINCT tm.user_id) AS member_count
                FROM teams t
                LEFT JOIN departments d ON d.id = t.department_id
                LEFT JOIN users m ON m.id = t.manager_id
                LEFT JOIN team_members tm ON tm.team_id = t.id
                GROUP BY t.id, t.team_name, t.department_id, d.department_name,
                         t.manager_id, m.full_name, t.description, t.is_active, t.created_at
                ORDER BY t.team_name
            """)
            teams = cursor.fetchall()
            member_scope = ""
            member_params = ()
        else:
            cursor.execute("""
                SELECT t.id, t.team_name, t.department_id, d.department_name,
                       t.manager_id, m.full_name AS manager_name,
                       t.description, t.is_active, t.created_at,
                       COUNT(DISTINCT tm.user_id) AS member_count
                FROM teams t
                LEFT JOIN departments d ON d.id = t.department_id
                LEFT JOIN users m ON m.id = t.manager_id
                LEFT JOIN team_members tm ON tm.team_id = t.id
                WHERE t.manager_id = %s AND t.is_active = TRUE
                GROUP BY t.id, t.team_name, t.department_id, d.department_name,
                         t.manager_id, m.full_name, t.description, t.is_active, t.created_at
                ORDER BY t.team_name
            """, (user_id,))
            teams = cursor.fetchall()
            member_scope = """
                AND (
                    u.manager_id = %s OR tm.team_id IN (
                        SELECT id FROM teams WHERE manager_id = %s AND is_active = TRUE
                    )
                )
            """
            member_params = (user_id, user_id)

        cursor.execute(f"""
            SELECT DISTINCT u.id, u.full_name, u.email, u.job_title,
                   u.department_id, d.department_name, u.manager_id,
                   u.is_active, u.created_at, r.role_name,
                   tm.team_id, t.team_name
            FROM users u
            INNER JOIN roles r ON r.id = u.role_id
            LEFT JOIN departments d ON d.id = u.department_id
            LEFT JOIN team_members tm ON tm.user_id = u.id
            LEFT JOIN teams t ON t.id = tm.team_id
            WHERE r.role_name = 'EMPLOYEE' {member_scope}
            ORDER BY u.full_name, t.team_name
        """, member_params)
        members = cursor.fetchall()

        if role == "ADMIN":
            cursor.execute("""
                SELECT u.id, u.full_name, u.email, u.department_id
                FROM users u JOIN roles r ON r.id = u.role_id
                WHERE r.role_name = 'EMPLOYEE' AND u.is_active = TRUE
                ORDER BY u.full_name
            """)
            available_members = cursor.fetchall()
            cursor.execute("""
                SELECT u.id, u.full_name FROM users u
                JOIN roles r ON r.id = u.role_id
                WHERE r.role_name = 'MANAGER' AND u.is_active = TRUE
                ORDER BY u.full_name
            """)
            managers = cursor.fetchall()
        else:
            # Managers may assign only their active direct reports.
            cursor.execute("""
                SELECT u.id, u.full_name, u.email, u.department_id
                FROM users u JOIN roles r ON r.id = u.role_id
                WHERE r.role_name = 'EMPLOYEE' AND u.is_active = TRUE
                  AND u.manager_id = %s
                ORDER BY u.full_name
            """, (user_id,))
            available_members = cursor.fetchall()
            managers = []

        cursor.execute("""
            SELECT id, department_name FROM departments
            WHERE is_active = TRUE ORDER BY department_name
        """)
        departments = cursor.fetchall()

        for row in teams + members:
            for key, value in list(row.items()):
                if hasattr(value, "isoformat"):
                    row[key] = value.isoformat(sep=" ") if hasattr(value, "hour") else value.isoformat()

        # Display employee codes are derived from the stable numeric user PK.
        for row in members:
            row["employee_code"] = f"CLM-EMP-{int(row['id']):03d}"
            row["is_active"] = bool(row["is_active"])
        for row in available_members:
            row["employee_code"] = f"CLM-EMP-{int(row['id']):03d}"

        stats = {
            "total_members": len({int(x["id"]) for x in members}),
            "department_count": len({x["department_id"] for x in members if x["department_id"] is not None}),
            "team_count": len(teams),
            "active_members": len({int(x["id"]) for x in members if x["is_active"]}),
        }
        return jsonify({
            "success": True, "role": role, "teams": teams, "members": members,
            "available_members": available_members, "managers": managers,
            "departments": departments, "stats": stats
        }), 200
    except Error:
        current_app.logger.exception("Team Management data retrieval failed")
        return api_error("Unable to load Team Management data.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


@bp.post("/api/teams")
@roles_required("ADMIN")
def create_team():
    conn = None
    cursor = None
    try:
        data = request.get_json(silent=True) or {}
        name = str(data.get("team_name", "")).strip()
        description = str(data.get("description", "")).strip() or None
        department_id = data.get("department_id") or None
        manager_id = data.get("manager_id") or None
        if not name or len(name) > 100:
            return api_error("Team name is required (maximum 100 characters).", 400)

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        if department_id:
            cursor.execute("SELECT id FROM departments WHERE id=%s AND is_active=TRUE", (department_id,))
            if not cursor.fetchone():
                return api_error("Selected department is not active.", 400)
        if manager_id:
            cursor.execute("""
                SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
                WHERE u.id=%s AND r.role_name='MANAGER' AND u.is_active=TRUE
            """, (manager_id,))
            if not cursor.fetchone():
                return api_error("Selected Manager is invalid or inactive.", 400)

        cursor.execute("""
            INSERT INTO teams (team_name, department_id, manager_id, description, is_active)
            VALUES (%s, %s, %s, %s, TRUE)
        """, (name, department_id, manager_id, description))
        team_id = cursor.lastrowid
        conn.commit()
        return jsonify({"success": True, "message": "Team created successfully.", "team_id": team_id}), 201
    except Error as exc:
        if conn:
            conn.rollback()
        if getattr(exc, "errno", None) == 1062:
            return api_error("A team with this name already exists in that department.", 409)
        current_app.logger.exception("Team creation failed")
        return api_error("Unable to create team.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


@bp.put("/api/teams/<int:team_id>")
@roles_required("ADMIN")
def update_team(team_id):
    conn = None
    cursor = None
    try:
        data = request.get_json(silent=True) or {}
        name = str(data.get("team_name", "")).strip()
        description = str(data.get("description", "")).strip() or None
        department_id = data.get("department_id") or None
        manager_id = data.get("manager_id") or None
        is_active = bool(data.get("is_active", True))
        if not name or len(name) > 100:
            return api_error("Team name is required (maximum 100 characters).", 400)

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id FROM teams WHERE id=%s", (team_id,))
        if not cursor.fetchone():
            return api_error("Team not found.", 404)
        if department_id:
            cursor.execute("SELECT id FROM departments WHERE id=%s AND is_active=TRUE", (department_id,))
            if not cursor.fetchone():
                return api_error("Selected department is not active.", 400)
        if manager_id:
            cursor.execute("""
                SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
                WHERE u.id=%s AND r.role_name='MANAGER' AND u.is_active=TRUE
            """, (manager_id,))
            if not cursor.fetchone():
                return api_error("Selected Manager is invalid or inactive.", 400)
        cursor.execute("""
            UPDATE teams SET team_name=%s, department_id=%s, manager_id=%s,
                description=%s, is_active=%s WHERE id=%s
        """, (name, department_id, manager_id, description, is_active, team_id))
        conn.commit()
        return jsonify({"success": True, "message": "Team updated successfully."}), 200
    except Error as exc:
        if conn:
            conn.rollback()
        if getattr(exc, "errno", None) == 1062:
            return api_error("A team with this name already exists in that department.", 409)
        current_app.logger.exception("Team update failed")
        return api_error("Unable to update team.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


@bp.post("/api/teams/<int:team_id>/members")
@roles_required("ADMIN", "MANAGER")
def add_team_member(team_id):
    conn = None
    cursor = None
    try:
        current = session["user"]
        role = str(current.get("role", "")).upper()
        current_id = int(current["id"])
        data = request.get_json(silent=True) or {}
        employee_id = int(data.get("user_id", 0))
        if employee_id <= 0:
            return api_error("Select an employee.", 400)

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, manager_id, is_active FROM teams WHERE id=%s", (team_id,))
        team = cursor.fetchone()
        if not team or not team["is_active"]:
            return api_error("Active team not found.", 404)
        if role == "MANAGER" and int(team["manager_id"] or 0) != current_id:
            return api_error("You can only add members to teams you manage.", 403)

        cursor.execute("""
            SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
            WHERE u.id=%s AND r.role_name='EMPLOYEE' AND u.is_active=TRUE
        """, (employee_id,))
        if not cursor.fetchone():
            return api_error("Only active Employee accounts can be assigned.", 400)
        if role == "MANAGER":
            cursor.execute("SELECT id FROM users WHERE id=%s AND manager_id=%s", (employee_id, current_id))
            if not cursor.fetchone():
                return api_error("You can assign only your direct-report employees.", 403)

        cursor.execute(
            "INSERT IGNORE INTO team_members (team_id, user_id) VALUES (%s, %s)",
            (team_id, employee_id)
        )
        inserted = cursor.rowcount > 0
        conn.commit()
        return jsonify({
            "success": True,
            "message": "Employee assigned to team." if inserted else "Employee is already in this team."
        }), 200
    except (Error, ValueError, TypeError):
        if conn:
            conn.rollback()
        current_app.logger.exception("Team member assignment failed")
        return api_error("Unable to assign employee to team.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


@bp.delete("/api/teams/<int:team_id>/members/<int:user_id>")
@roles_required("ADMIN", "MANAGER")
def remove_team_member(team_id, user_id):
    conn = None
    cursor = None
    try:
        current = session["user"]
        role = str(current.get("role", "")).upper()
        current_id = int(current["id"])
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, manager_id FROM teams WHERE id=%s", (team_id,))
        team = cursor.fetchone()
        if not team:
            return api_error("Team not found.", 404)
        if role == "MANAGER" and int(team["manager_id"] or 0) != current_id:
            return api_error("You can only remove members from teams you manage.", 403)
        cursor.execute("DELETE FROM team_members WHERE team_id=%s AND user_id=%s", (team_id, user_id))
        removed = cursor.rowcount > 0
        conn.commit()
        if not removed:
            return api_error("Employee is not a member of this team.", 404)
        return jsonify({"success": True, "message": "Employee removed from team."}), 200
    except Error:
        if conn:
            conn.rollback()
        current_app.logger.exception("Team member removal failed")
        return api_error("Unable to remove employee from team.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass

