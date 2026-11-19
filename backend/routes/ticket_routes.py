from flask import Blueprint, current_app, jsonify, redirect, request, session, send_file
from mysql.connector import Error
from datetime import datetime, timedelta
from pathlib import Path
import os
import uuid
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from common import get_db_connection, api_error, login_required, roles_required, BACKEND_DIR
from ticket_scope import build_ticket_scope

TICKET_ROUTES_BP = Blueprint("ticket_routes", __name__)
bp = TICKET_ROUTES_BP
TICKET_ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "doc", "docx", "txt"}
TICKET_MAX_FILE_SIZE = 5 * 1024 * 1024
TICKET_UPLOAD_DIR = BACKEND_DIR / "uploads" / "tickets"
TICKET_PRIORITY_VALUES = {"LOW", "MEDIUM", "HIGH", "URGENT"}
TICKET_CATEGORIES = {
    "IT Support", "Hardware", "Software", "Network",
    "HR", "Finance", "Administration", "Other"
}

@bp.post("/api/tickets")
@roles_required("EMPLOYEE", "MANAGER")
def create_ticket():
    """Create a real ticket and optional attachment in MySQL."""
    title = str(request.form.get("title", "")).strip()
    description = str(request.form.get("description", "")).strip()
    category = str(request.form.get("category", "")).strip()
    priority = str(request.form.get("priority", "")).strip().upper()
    department_raw = request.form.get("department_id", "").strip()
    attachment = request.files.get("attachment")

    if not title or not description or not category or not department_raw or not priority:
        return api_error("Title, description, category, department and priority are required.", 400)
    if len(title) < 5 or len(title) > 200:
        return api_error("Ticket title must contain between 5 and 200 characters.", 400)
    if len(description) < 15 or len(description) > 2000:
        return api_error("Description must contain between 15 and 2000 characters.", 400)
    if category not in TICKET_CATEGORIES:
        return api_error("Please select a valid ticket category.", 400)
    if priority not in TICKET_PRIORITY_VALUES:
        return api_error("Please select a valid priority.", 400)
    try:
        department_id = int(department_raw)
        if department_id <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return api_error("Please select a valid department.", 400)

    saved_path = None
    conn = None
    cursor = None
    try:
        # Validate attachment before writing anything to disk.
        original_filename = stored_filename = storage_path = mime_type = None
        file_size = None
        if attachment and attachment.filename:
            safe_original = secure_filename(attachment.filename)
            if not safe_original:
                return api_error("The attachment filename is invalid.", 400)
            extension = safe_original.rsplit(".", 1)[-1].lower() if "." in safe_original else ""
            if extension not in TICKET_ALLOWED_EXTENSIONS:
                return api_error("Unsupported attachment type. Allowed: PDF, PNG, JPG, DOC, DOCX and TXT.", 400)
            attachment.stream.seek(0, os.SEEK_END)
            file_size = attachment.stream.tell()
            attachment.stream.seek(0)
            if file_size <= 0:
                return api_error("The attachment is empty.", 400)
            if file_size > TICKET_MAX_FILE_SIZE:
                return api_error("Attachment must not exceed 5 MB.", 400)
            original_filename = attachment.filename[:255]
            stored_filename = f"{uuid.uuid4().hex}.{extension}"
            mime_type = attachment.mimetype or None

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT id FROM departments
            WHERE id = %s AND is_active = TRUE
            LIMIT 1
        """, (department_id,))
        if not cursor.fetchone():
            return api_error("The selected department is unavailable.", 400)

        creator_id = int(session["user"]["id"])
        # Temporary unique reference is never visible outside this transaction.
        temporary_number = f"TMP-{uuid.uuid4().hex[:24]}"  # 28 chars; fits VARCHAR(30)
        cursor.execute("""
            INSERT INTO tickets (
                ticket_number, title, description, category, priority,
                status, created_by, department_id
            ) VALUES (%s, %s, %s, %s, %s, 'OPEN', %s, %s)
        """, (temporary_number, title, description, category, priority,
              creator_id, department_id))
        ticket_id = cursor.lastrowid
        ticket_number = f"CLM-{datetime.now().year}-{ticket_id:06d}"
        cursor.execute("UPDATE tickets SET ticket_number = %s WHERE id = %s",
                       (ticket_number, ticket_id))

        if attachment and attachment.filename:
            TICKET_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            saved_path = TICKET_UPLOAD_DIR / stored_filename
            attachment.save(saved_path)
            relative_path = (Path("uploads") / "tickets" / stored_filename).as_posix()
            cursor.execute("""
                INSERT INTO ticket_attachments (
                    ticket_id, uploaded_by, original_filename, stored_filename,
                    storage_path, mime_type, file_size
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (ticket_id, creator_id, original_filename, stored_filename,
                  relative_path, mime_type, file_size))

        # Persist notifications in the same transaction as the ticket.
        cursor.execute("""
            INSERT INTO notifications (user_id, ticket_id, title, message, notification_type)
            VALUES (%s, %s, %s, %s, %s)
        """, (
            creator_id, ticket_id, "Ticket submitted",
            f"Your ticket {ticket_number} was created successfully.", "TICKET"
        ))

        # Notify the creator's direct manager, when one is assigned.
        cursor.execute("SELECT manager_id FROM users WHERE id = %s", (creator_id,))
        manager_row = cursor.fetchone()
        manager_id = manager_row.get("manager_id") if manager_row else None
        if manager_id and int(manager_id) != creator_id:
            cursor.execute("""
                INSERT INTO notifications (user_id, ticket_id, title, message, notification_type)
                VALUES (%s, %s, %s, %s, %s)
            """, (
                int(manager_id), ticket_id, "New team ticket",
                f"{ticket_number}: {title} was submitted by a reporting employee.", "TICKET"
            ))

        conn.commit()
        return jsonify({
            "success": True,
            "message": "Ticket created successfully.",
            "ticket": {
                "id": ticket_id,
                "ticket_number": ticket_number,
                "title": title,
                "description": description,
                "category": category,
                "priority": priority,
                "status": "OPEN",
                "created_by": creator_id,
                "department_id": department_id,
                "attachment": ({
                    "original_filename": original_filename,
                    "file_size": file_size
                } if original_filename else None)
            }
        }), 201

    except Error:
        if conn:
            conn.rollback()
        _remove_saved_upload(saved_path)
        current_app.logger.exception("Ticket creation database operation failed")
        return api_error("Unable to create the ticket because of a database error.", 500)
    except OSError:
        if conn:
            conn.rollback()
        _remove_saved_upload(saved_path)
        current_app.logger.exception("Ticket attachment could not be saved")
        return api_error("Unable to save the attachment. Please try again.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                current_app.logger.warning("Error while closing a MySQL connection.")


@bp.get("/api/tickets/my")
@roles_required("EMPLOYEE", "MANAGER")
def get_my_tickets():
    """Return only tickets created by the currently authenticated user."""
    conn = None
    cursor = None

    try:
        user_id = int(session["user"]["id"])
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                t.id,
                t.ticket_number,
                t.title,
                t.description,
                t.category,
                t.priority,
                t.status,
                t.created_at,
                t.updated_at,
                t.due_date,
                t.resolved_at,
                t.closed_at,
                t.created_by,
                t.department_id,
                d.department_name,
                t.assigned_to,
                assigned_user.full_name AS assigned_to_name,
                t.team_id,
                tm.team_name,
                CASE
                    WHEN t.created_by = %s AND (
                        t.assigned_to = %s OR t.team_id IN (
                            SELECT member_team.team_id FROM team_members member_team
                            INNER JOIN teams active_team ON active_team.id = member_team.team_id
                            WHERE member_team.user_id = %s AND active_team.is_active = TRUE
                        )
                    ) THEN 'BOTH'
                    WHEN t.created_by = %s THEN 'CREATED'
                    ELSE 'ASSIGNED'
                END AS ticket_relationship
            FROM tickets AS t
            LEFT JOIN departments AS d
                ON d.id = t.department_id
            LEFT JOIN users AS assigned_user
                ON assigned_user.id = t.assigned_to
            LEFT JOIN teams AS tm
                ON tm.id = t.team_id
            WHERE (
                t.created_by = %s
                OR t.assigned_to = %s
                OR t.team_id IN (
                    SELECT tm.team_id FROM team_members tm
                    INNER JOIN teams active_team ON active_team.id = tm.team_id
                    WHERE tm.user_id = %s AND active_team.is_active = TRUE
                )
            )
            ORDER BY t.created_at DESC, t.id DESC
        """, (user_id, user_id, user_id, user_id, user_id, user_id, user_id))

        rows = cursor.fetchall()

        # Convert MySQL date/time values to JSON-safe ISO strings.
        for row in rows:
            for key in (
                "created_at", "updated_at", "due_date",
                "resolved_at", "closed_at"
            ):
                if row.get(key) is not None:
                    row[key] = row[key].isoformat(sep=" ")

        return jsonify({
            "success": True,
            "tickets": rows,
            "count": len(rows)
        }), 200

    except (Error, ValueError, TypeError):
        current_app.logger.exception("My Tickets retrieval failed")
        return api_error("Unable to load your tickets from the database.", 500)

    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                current_app.logger.warning("Error while closing a MySQL connection.")


@bp.get("/api/tickets")
@roles_required("MANAGER", "ADMIN")
def get_all_tickets():
    """Return tickets within the authenticated Manager scope or all Admin scope."""
    conn = None
    cursor = None
    try:
        current = session["user"]
        role = str(current.get("role", "")).upper()
        user_id = int(current["id"])
        scope_sql, scope_params = build_ticket_scope(role, user_id)

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute(f"""
            SELECT
                t.id,
                t.ticket_number,
                t.title,
                t.description,
                t.category,
                t.priority,
                t.status,
                t.created_at,
                t.updated_at,
                t.due_date,
                t.resolved_at,
                t.closed_at,
                t.created_by,
                creator.full_name AS created_by_name,
                creator.email AS created_by_email,
                t.department_id,
                d.department_name,
                t.assigned_to,
                assignee.full_name AS assigned_to_name,
                t.team_id,
                team.team_name
            FROM tickets AS t
            LEFT JOIN users AS creator ON creator.id = t.created_by
            LEFT JOIN users AS assignee ON assignee.id = t.assigned_to
            LEFT JOIN departments AS d ON d.id = t.department_id
            LEFT JOIN teams AS team ON team.id = t.team_id
            WHERE {scope_sql}
            ORDER BY t.created_at DESC, t.id DESC
        """, tuple(scope_params))

        tickets = cursor.fetchall()
        for row in tickets:
            for key in ("created_at", "updated_at", "due_date", "resolved_at", "closed_at"):
                if row.get(key) is not None:
                    row[key] = row[key].isoformat(sep=" ")

        stats = {
            "total": len(tickets),
            "open_count": sum(row["status"] == "OPEN" for row in tickets),
            "in_progress_count": sum(row["status"] == "IN_PROGRESS" for row in tickets),
            "on_hold_count": sum(row["status"] == "ON_HOLD" for row in tickets),
            "resolved_count": sum(row["status"] == "RESOLVED" for row in tickets),
            "closed_count": sum(row["status"] == "CLOSED" for row in tickets),
            "rejected_count": sum(row["status"] == "REJECTED" for row in tickets),
        }

        return jsonify({
            "success": True,
            "scope": "MANAGED_TEAMS_AND_DIRECT_REPORTS" if role == "MANAGER" else "ORGANIZATION",
            "tickets": tickets,
            "count": len(tickets),
            "stats": stats,
        }), 200

    except (Error, ValueError, TypeError):
        current_app.logger.exception("All Tickets retrieval failed")
        return api_error("Unable to load tickets from the database.", 500)

    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                current_app.logger.warning("Error while closing All Tickets database connection.")



@bp.get("/api/tickets/assignment-options")
@roles_required("MANAGER", "ADMIN")
def get_ticket_assignment_options():
    """Return active employees and teams the current Manager/Admin may assign to."""
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
                SELECT u.id, u.full_name, u.email
                FROM users u
                INNER JOIN roles r ON r.id = u.role_id
                WHERE r.role_name = 'EMPLOYEE' AND u.is_active = TRUE
                ORDER BY u.full_name
            """)
            employees = cursor.fetchall()
            cursor.execute("""
                SELECT id, team_name FROM teams
                WHERE is_active = TRUE ORDER BY team_name
            """)
            teams = cursor.fetchall()
        else:
            cursor.execute("""
                SELECT DISTINCT u.id, u.full_name, u.email
                FROM users u
                INNER JOIN roles r ON r.id = u.role_id
                LEFT JOIN team_members tm ON tm.user_id = u.id
                LEFT JOIN teams t ON t.id = tm.team_id AND t.is_active = TRUE
                WHERE r.role_name = 'EMPLOYEE' AND u.is_active = TRUE
                  AND (
                    u.manager_id = %s
                    OR t.manager_id = %s
                  )
                ORDER BY u.full_name
            """, (user_id, user_id))
            employees = cursor.fetchall()
            cursor.execute("""
                SELECT id, team_name FROM teams
                WHERE manager_id = %s AND is_active = TRUE
                ORDER BY team_name
            """, (user_id,))
            teams = cursor.fetchall()

        return jsonify({"success": True, "employees": employees, "teams": teams}), 200
    except Error:
        current_app.logger.exception("Ticket assignment options retrieval failed")
        return api_error("Unable to load ticket assignment options.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


@bp.patch("/api/tickets/<int:ticket_id>/assignment")
@roles_required("MANAGER", "ADMIN")
def update_ticket_assignment(ticket_id):
    """Assign/reassign a ticket to one active employee or one active team."""
    data = request.get_json(silent=True) or {}
    assigned_to = data.get("assigned_to")
    team_id = data.get("team_id")

    if assigned_to not in (None, "") and team_id not in (None, ""):
        return api_error("Assign a ticket to either an employee or a team, not both.", 400)
    try:
        assigned_to = int(assigned_to) if assigned_to not in (None, "") else None
        team_id = int(team_id) if team_id not in (None, "") else None
        if assigned_to is not None and assigned_to <= 0:
            raise ValueError
        if team_id is not None and team_id <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return api_error("The selected assignment is invalid.", 400)

    current = session["user"]
    role = str(current.get("role", "")).upper()
    actor_id = int(current["id"])
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        scope_sql, scope_params = build_ticket_scope(role, actor_id)
        cursor.execute(f"""
            SELECT t.id, t.ticket_number, t.title, t.created_by,
                   t.assigned_to, t.team_id
            FROM tickets t
            WHERE t.id = %s AND {scope_sql}
            FOR UPDATE
        """, (ticket_id, *scope_params))
        ticket = cursor.fetchone()
        if not ticket:
            conn.rollback()
            return api_error("Ticket not found or you do not have permission to manage it.", 404)

        if assigned_to is not None:
            cursor.execute("""
                SELECT u.id FROM users u
                INNER JOIN roles r ON r.id = u.role_id
                WHERE u.id = %s AND r.role_name = 'EMPLOYEE' AND u.is_active = TRUE
                LIMIT 1
            """, (assigned_to,))
            if not cursor.fetchone():
                conn.rollback()
                return api_error("Select an active Employee account.", 400)
            if role == "MANAGER":
                cursor.execute("""
                    SELECT u.id
                    FROM users u
                    LEFT JOIN team_members tm ON tm.user_id = u.id
                    LEFT JOIN teams t ON t.id = tm.team_id AND t.is_active = TRUE
                    WHERE u.id = %s
                      AND (u.manager_id = %s OR t.manager_id = %s)
                    LIMIT 1
                """, (assigned_to, actor_id, actor_id))
                if not cursor.fetchone():
                    conn.rollback()
                    return api_error("You can assign tickets only to your direct reports or members of teams you manage.", 403)

        if team_id is not None:
            cursor.execute("SELECT id, manager_id FROM teams WHERE id = %s AND is_active = TRUE", (team_id,))
            team = cursor.fetchone()
            if not team:
                conn.rollback()
                return api_error("Select an active team.", 400)
            if role == "MANAGER" and int(team.get("manager_id") or 0) != actor_id:
                conn.rollback()
                return api_error("You can assign tickets only to teams you manage.", 403)

        previous_assigned_to = ticket.get("assigned_to")
        previous_team_id = ticket.get("team_id")
        assignment_changed = (
            (int(previous_assigned_to) if previous_assigned_to is not None else None) != assigned_to
            or (int(previous_team_id) if previous_team_id is not None else None) != team_id
        )

        cursor.execute("""
            UPDATE tickets
            SET assigned_to = %s, team_id = %s, updated_at = NOW()
            WHERE id = %s
        """, (assigned_to, team_id, ticket_id))

        # Notify only the new assignment recipients. Keep this in the same
        # transaction so a failed ticket update cannot leave a false alert.
        if assignment_changed:
            recipient_ids = set()
            assignment_label = None
            if assigned_to is not None:
                recipient_ids.add(assigned_to)
                cursor.execute("SELECT full_name FROM users WHERE id = %s", (assigned_to,))
                assignee_row = cursor.fetchone()
                assignment_label = assignee_row["full_name"] if assignee_row else "an employee"
            elif team_id is not None:
                cursor.execute("""
                    SELECT u.id
                    FROM team_members tm
                    INNER JOIN users u ON u.id = tm.user_id
                    WHERE tm.team_id = %s AND u.is_active = TRUE
                """, (team_id,))
                recipient_ids.update(int(row["id"]) for row in cursor.fetchall())
                cursor.execute("SELECT manager_id, team_name FROM teams WHERE id = %s", (team_id,))
                team_row = cursor.fetchone()
                if team_row and team_row.get("manager_id"):
                    recipient_ids.add(int(team_row["manager_id"]))
                assignment_label = team_row["team_name"] if team_row else "a team"

            # Do not notify the person who performed the assignment.
            recipient_ids.discard(actor_id)
            for recipient_id in recipient_ids:
                notification_title = "Ticket assigned to you" if assigned_to is not None else "Ticket assigned to your team"
                notification_message = (
                    f"{ticket['ticket_number']}: {ticket['title']} was assigned to you."
                    if assigned_to is not None
                    else f"{ticket['ticket_number']}: {ticket['title']} was assigned to team {assignment_label}."
                )
                cursor.execute("""
                    INSERT INTO notifications
                        (user_id, ticket_id, title, message, notification_type)
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    recipient_id, ticket_id, notification_title,
                    notification_message, "ASSIGNMENT"
                ))

        conn.commit()
        return jsonify({
            "success": True,
            "message": "Ticket assignment updated successfully.",
            "ticket_id": ticket_id,
            "assigned_to": assigned_to,
            "team_id": team_id
        }), 200
    except Error:
        if conn:
            conn.rollback()
        current_app.logger.exception("Ticket assignment update failed")
        return api_error("Unable to update ticket assignment.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


@bp.patch("/api/tickets/<int:ticket_id>/status")
@roles_required("MANAGER", "ADMIN")
def update_ticket_status(ticket_id):
    """Update ticket status within the authenticated Manager/Admin ticket scope."""
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "")).strip().upper().replace(" ", "_")
    allowed_statuses = {"OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "REJECTED"}
    if status not in allowed_statuses:
        return api_error("Select a valid ticket status.", 400)

    current = session["user"]
    role = str(current.get("role", "")).upper()
    actor_id = int(current["id"])
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        scope_sql, scope_params = build_ticket_scope(role, actor_id)
        cursor.execute(f"""
            SELECT t.id, t.ticket_number, t.status
            FROM tickets t
            WHERE t.id = %s AND {scope_sql}
            FOR UPDATE
        """, (ticket_id, *scope_params))
        ticket = cursor.fetchone()
        if not ticket:
            conn.rollback()
            return api_error("Ticket not found or you do not have permission to update it.", 404)

        old_status = str(ticket["status"]).upper()
        if old_status == status:
            conn.rollback()
            return jsonify({"success": True, "message": "Ticket already has this status.", "status": status}), 200

        cursor.execute("""
            UPDATE tickets
            SET status = %s,
                resolved_at = CASE
                    WHEN %s = 'RESOLVED' THEN COALESCE(resolved_at, NOW())
                    WHEN %s = 'CLOSED' THEN COALESCE(resolved_at, NOW())
                    ELSE NULL
                END,
                closed_at = CASE WHEN %s = 'CLOSED' THEN COALESCE(closed_at, NOW()) ELSE NULL END,
                updated_at = NOW()
            WHERE id = %s
        """, (status, status, status, status, ticket_id))

        # The ticket creator is informed of every actual status transition.
        cursor.execute("SELECT created_by, title FROM tickets WHERE id = %s", (ticket_id,))
        owner = cursor.fetchone()
        creator_id = int(owner["created_by"]) if owner and owner.get("created_by") else None
        if creator_id and creator_id != actor_id:
            status_label = status.replace("_", " ").title()
            cursor.execute("""
                INSERT INTO notifications
                    (user_id, ticket_id, title, message, notification_type)
                VALUES (%s, %s, %s, %s, %s)
            """, (
                creator_id, ticket_id, "Ticket status updated",
                f"{ticket['ticket_number']}: {owner['title']} status changed from "
                f"{old_status.replace('_', ' ').title()} to {status_label}.",
                "TICKET"
            ))
        conn.commit()
        return jsonify({
            "success": True,
            "message": "Ticket status updated successfully.",
            "ticket_id": ticket_id,
            "ticket_number": ticket["ticket_number"],
            "previous_status": old_status,
            "status": status
        }), 200
    except Error:
        if conn:
            conn.rollback()
        current_app.logger.exception("Ticket status update failed")
        return api_error("Unable to update ticket status.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                pass


# ---------------------------------------------------------------------------
# Employee ticket work, comments, resolution and secure attachment access
# ---------------------------------------------------------------------------
def _employee_can_work_ticket(cursor, ticket_id, user_id):
    """Employees may work tickets assigned directly or to one of their active teams."""
    cursor.execute("""
        SELECT t.id, t.ticket_number, t.title, t.created_by, t.assigned_to,
               t.team_id, t.status
        FROM tickets t
        WHERE t.id = %s
          AND (
              t.assigned_to = %s
              OR t.team_id IN (
                  SELECT tm.team_id
                  FROM team_members tm
                  INNER JOIN teams team ON team.id = tm.team_id
                  WHERE tm.user_id = %s AND team.is_active = TRUE
              )
          )
        LIMIT 1
        FOR UPDATE
    """, (ticket_id, user_id, user_id))
    return cursor.fetchone()


def _ticket_access_allowed(cursor, ticket, user, role):
    """Check whether the current account may view a ticket's detail/history."""
    user_id = int(user["id"])
    if role == "ADMIN":
        return True
    if role == "MANAGER":
        scope_sql, scope_params = build_ticket_scope(role, user_id)
        cursor.execute(f"SELECT t.id FROM tickets t WHERE t.id = %s AND {scope_sql} LIMIT 1",
                       (int(ticket["id"]), *scope_params))
        return cursor.fetchone() is not None
    cursor.execute("""
        SELECT t.id FROM tickets t
        WHERE t.id = %s AND (
            t.created_by = %s OR t.assigned_to = %s OR t.team_id IN (
                SELECT tm.team_id FROM team_members tm
                INNER JOIN teams team ON team.id = tm.team_id
                WHERE tm.user_id = %s AND team.is_active = TRUE
            )
        ) LIMIT 1
    """, (int(ticket["id"]), user_id, user_id, user_id))
    return cursor.fetchone() is not None


@bp.get("/api/tickets/<int:ticket_id>/details")
@roles_required("EMPLOYEE", "MANAGER", "ADMIN")
def get_ticket_details(ticket_id):
    conn = None
    cursor = None
    try:
        user = session["user"]
        role = str(user.get("role", "")).upper()
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT t.*, d.department_name, creator.full_name AS created_by_name,
                   assignee.full_name AS assigned_to_name, team.team_name
            FROM tickets t
            LEFT JOIN departments d ON d.id = t.department_id
            LEFT JOIN users creator ON creator.id = t.created_by
            LEFT JOIN users assignee ON assignee.id = t.assigned_to
            LEFT JOIN teams team ON team.id = t.team_id
            WHERE t.id = %s LIMIT 1
        """, (ticket_id,))
        ticket = cursor.fetchone()
        if not ticket or not _ticket_access_allowed(cursor, ticket, user, role):
            return api_error("Ticket not found or you do not have permission to view it.", 404)

        cursor.execute("""
            SELECT c.id, c.user_id, u.full_name AS author_name,
                   c.comment_text, c.created_at
            FROM ticket_comments c
            INNER JOIN users u ON u.id = c.user_id
            WHERE c.ticket_id = %s AND c.is_internal = FALSE
            ORDER BY c.created_at ASC, c.id ASC
        """, (ticket_id,))
        comments = cursor.fetchall()
        cursor.execute("""
            SELECT id, original_filename, mime_type, file_size, created_at
            FROM ticket_attachments WHERE ticket_id = %s
            ORDER BY created_at ASC, id ASC
        """, (ticket_id,))
        attachments = cursor.fetchall()

        for row in [ticket, *comments, *attachments]:
            for key, value in list(row.items()):
                if hasattr(value, "isoformat"):
                    row[key] = value.isoformat(sep=" ")
        return jsonify({"success": True, "ticket": ticket,
                        "comments": comments, "attachments": attachments}), 200
    except Error:
        current_app.logger.exception("Ticket detail retrieval failed")
        return api_error("Unable to load ticket details.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error:
                pass


@bp.get("/api/tickets/<int:ticket_id>/attachments/<int:attachment_id>")
@roles_required("EMPLOYEE", "MANAGER", "ADMIN")
def download_ticket_attachment(ticket_id, attachment_id):
    conn = None
    cursor = None
    try:
        user = session["user"]
        role = str(user.get("role", "")).upper()
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, created_by FROM tickets WHERE id = %s", (ticket_id,))
        ticket = cursor.fetchone()
        if not ticket or not _ticket_access_allowed(cursor, ticket, user, role):
            return api_error("Attachment not found or access denied.", 404)
        cursor.execute("""
            SELECT original_filename, storage_path FROM ticket_attachments
            WHERE id = %s AND ticket_id = %s
        """, (attachment_id, ticket_id))
        attachment = cursor.fetchone()
        if not attachment:
            return api_error("Attachment not found.", 404)
        base_dir = (BACKEND_DIR / "uploads" / "tickets").resolve()
        file_path = (BACKEND_DIR / attachment["storage_path"]).resolve()
        if base_dir not in file_path.parents or not file_path.is_file():
            return api_error("The attachment file is unavailable.", 404)
        return send_file(file_path, as_attachment=True,
                         download_name=attachment["original_filename"])
    except Error:
        current_app.logger.exception("Ticket attachment download failed")
        return api_error("Unable to download the attachment.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error:
                pass


@bp.post("/api/tickets/<int:ticket_id>/comments")
@roles_required("EMPLOYEE", "MANAGER", "ADMIN")
def add_ticket_comment(ticket_id):
    data = request.get_json(silent=True) or {}
    comment_text = str(data.get("comment", "")).strip()
    if not comment_text or len(comment_text) > 4000:
        return api_error("Comment is required and must not exceed 4000 characters.", 400)
    user = session["user"]
    role = str(user.get("role", "")).upper()
    user_id = int(user["id"])
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, created_by FROM tickets WHERE id = %s", (ticket_id,))
        ticket = cursor.fetchone()
        if not ticket or not _ticket_access_allowed(cursor, ticket, user, role):
            conn.rollback()
            return api_error("Ticket not found or you do not have permission to comment.", 404)
        cursor.execute("""
            INSERT INTO ticket_comments (ticket_id, user_id, comment_text, is_internal)
            VALUES (%s, %s, %s, FALSE)
        """, (ticket_id, user_id, comment_text))
        comment_id = cursor.lastrowid
        conn.commit()
        return jsonify({"success": True, "message": "Comment added.", "comment_id": comment_id}), 201
    except Error:
        if conn: conn.rollback()
        current_app.logger.exception("Ticket comment creation failed")
        return api_error("Unable to add your comment.", 500)
    finally:
        if cursor: cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error: pass


@bp.patch("/api/tickets/<int:ticket_id>/work-status")
@roles_required("EMPLOYEE")
def update_employee_work_status(ticket_id):
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "")).strip().upper().replace(" ", "_")
    if status != "IN_PROGRESS":
        return api_error("Employees can use this action only to start work on an assigned ticket.", 400)
    user_id = int(session["user"]["id"])
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        ticket = _employee_can_work_ticket(cursor, ticket_id, user_id)
        if not ticket:
            conn.rollback()
            return api_error("This ticket is not assigned to you or one of your active teams.", 403)
        old_status = str(ticket["status"]).upper()
        if old_status in {"RESOLVED", "CLOSED", "REJECTED"}:
            conn.rollback()
            return api_error("A completed ticket cannot be started again. Ask your manager to reopen it.", 409)
        if old_status == "IN_PROGRESS":
            conn.rollback()
            return jsonify({"success": True, "message": "Ticket is already in progress."}), 200
        cursor.execute("UPDATE tickets SET status = 'IN_PROGRESS', resolved_at = NULL, closed_at = NULL, updated_at = NOW() WHERE id = %s",
                       (ticket_id,))
        if int(ticket["created_by"]) != user_id:
            cursor.execute("""
                INSERT INTO notifications (user_id, ticket_id, title, message, notification_type)
                VALUES (%s, %s, %s, %s, %s)
            """, (int(ticket["created_by"]), ticket_id, "Ticket work started",
                  f"{ticket['ticket_number']}: work has started on your ticket.", "TICKET"))
        conn.commit()
        return jsonify({"success": True, "message": "Ticket moved to In Progress.", "status": "IN_PROGRESS"}), 200
    except Error:
        if conn: conn.rollback()
        current_app.logger.exception("Employee ticket start failed")
        return api_error("Unable to start work on this ticket.", 500)
    finally:
        if cursor: cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error: pass


@bp.post("/api/tickets/<int:ticket_id>/resolve")
@roles_required("EMPLOYEE")
def resolve_assigned_ticket(ticket_id):
    data = request.get_json(silent=True) or {}
    resolution = str(data.get("resolution", "")).strip()
    if len(resolution) < 10 or len(resolution) > 4000:
        return api_error("Please provide a resolution summary between 10 and 4000 characters.", 400)
    user_id = int(session["user"]["id"])
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        ticket = _employee_can_work_ticket(cursor, ticket_id, user_id)
        if not ticket:
            conn.rollback()
            return api_error("This ticket is not assigned to you or one of your active teams.", 403)
        old_status = str(ticket["status"]).upper()
        if old_status in {"RESOLVED", "CLOSED", "REJECTED"}:
            conn.rollback()
            return api_error("This ticket is already completed and cannot be resolved again.", 409)
        if old_status != "IN_PROGRESS":
            conn.rollback()
            return api_error("Start work on this ticket before submitting its resolution.", 409)
        cursor.execute("""
            INSERT INTO ticket_comments (ticket_id, user_id, comment_text, is_internal)
            VALUES (%s, %s, %s, FALSE)
        """, (ticket_id, user_id, f"Resolution: {resolution}"))
        cursor.execute("""
            UPDATE tickets SET status = 'RESOLVED', resolved_at = NOW(), closed_at = NULL,
                               updated_at = NOW()
            WHERE id = %s
        """, (ticket_id,))
        creator_id = int(ticket["created_by"])
        if creator_id != user_id:
            cursor.execute("""
                INSERT INTO notifications (user_id, ticket_id, title, message, notification_type)
                VALUES (%s, %s, %s, %s, %s)
            """, (creator_id, ticket_id, "Ticket resolved",
                  f"{ticket['ticket_number']}: {ticket['title']} has been resolved. Review the resolution details.", "TICKET"))
        conn.commit()
        return jsonify({"success": True, "message": "Resolution submitted successfully.",
                        "status": "RESOLVED", "ticket_number": ticket["ticket_number"]}), 200
    except Error:
        if conn: conn.rollback()
        current_app.logger.exception("Employee ticket resolution failed")
        return api_error("Unable to submit the ticket resolution.", 500)
    finally:
        if cursor: cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error: pass

def _remove_saved_upload(path):
    if path and path.exists():
        try:
            path.unlink()
        except OSError:
            current_app.logger.exception("Could not remove an uncommitted ticket attachment")

