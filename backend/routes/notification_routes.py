from flask import Blueprint, current_app, jsonify, redirect, request, session
from mysql.connector import Error
from datetime import datetime, timedelta
from pathlib import Path
import os
import uuid
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from common import get_db_connection, api_error, login_required, roles_required, BACKEND_DIR

NOTIFICATION_ROUTES_BP = Blueprint("notification_routes", __name__)
bp = NOTIFICATION_ROUTES_BP

@bp.get("/api/notifications")
@login_required
def get_notifications():
    """Return only the signed-in user's notifications and unread count."""
    conn = None
    cursor = None
    try:
        user_id = int(session["user"]["id"])
        limit = request.args.get("limit", "100")
        try:
            limit = max(1, min(int(limit), 200))
        except (TypeError, ValueError):
            limit = 100

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT n.id, n.ticket_id, t.ticket_number, n.title, n.message,
                   n.notification_type, n.is_read, n.created_at, n.read_at
            FROM notifications AS n
            LEFT JOIN tickets AS t ON t.id = n.ticket_id
            WHERE n.user_id = %s
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT %s
        """, (user_id, limit))
        rows = cursor.fetchall()
        for row in rows:
            row["is_read"] = bool(row["is_read"])
            for key in ("created_at", "read_at"):
                if row.get(key) is not None:
                    row[key] = row[key].isoformat(sep=" ")

        cursor.execute("SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = %s AND is_read = FALSE", (user_id,))
        unread_count = int(cursor.fetchone()["unread_count"])
        cursor.execute("SELECT COUNT(*) AS today_count FROM notifications WHERE user_id = %s AND DATE(created_at) = CURDATE()", (user_id,))
        today_count = int(cursor.fetchone()["today_count"])
        cursor.execute("SELECT COUNT(*) AS total_count FROM notifications WHERE user_id = %s", (user_id,))
        total_count = int(cursor.fetchone()["total_count"])
        return jsonify({
            "success": True, "notifications": rows,
            "counts": {"total": total_count, "unread": unread_count, "today": today_count}
        }), 200
    except (Error, ValueError, TypeError):
        current_app.logger.exception("Notifications retrieval failed")
        return api_error("Unable to load notifications from the database.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error:
                current_app.logger.warning("Error closing notifications database connection.")


@bp.patch("/api/notifications/<int:notification_id>/read")
@login_required
def update_notification_read(notification_id):
    """Update read state only when the notification belongs to this user."""
    conn = None
    cursor = None
    data = request.get_json(silent=True) or {}
    is_read = data.get("is_read", True)
    if not isinstance(is_read, bool):
        return api_error("is_read must be true or false.", 400)
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE notifications
            SET is_read = %s, read_at = %s
            WHERE id = %s AND user_id = %s
        """, (is_read, datetime.now() if is_read else None, notification_id, int(session["user"]["id"])))
        if cursor.rowcount == 0:
            cursor.execute("SELECT id FROM notifications WHERE id = %s AND user_id = %s", (notification_id, int(session["user"]["id"])))
            if not cursor.fetchone():
                conn.rollback()
                return api_error("Notification not found.", 404)
        conn.commit()
        return jsonify({"success": True, "message": "Notification updated."}), 200
    except Error:
        if conn: conn.rollback()
        current_app.logger.exception("Notification read-state update failed")
        return api_error("Unable to update this notification.", 500)
    finally:
        if cursor: cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error: pass


@bp.post("/api/notifications/read-all")
@login_required
def mark_all_notifications_read():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE notifications SET is_read = TRUE, read_at = NOW()
            WHERE user_id = %s AND is_read = FALSE
        """, (int(session["user"]["id"]),))
        changed = cursor.rowcount
        conn.commit()
        return jsonify({"success": True, "updated": changed}), 200
    except Error:
        if conn: conn.rollback()
        current_app.logger.exception("Mark all notifications read failed")
        return api_error("Unable to mark notifications as read.", 500)
    finally:
        if cursor: cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error: pass


@bp.delete("/api/notifications/<int:notification_id>")
@login_required
def dismiss_notification(notification_id):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM notifications WHERE id = %s AND user_id = %s", (notification_id, int(session["user"]["id"])))
        if cursor.rowcount == 0:
            conn.rollback()
            return api_error("Notification not found.", 404)
        conn.commit()
        return jsonify({"success": True, "message": "Notification dismissed."}), 200
    except Error:
        if conn: conn.rollback()
        current_app.logger.exception("Notification dismissal failed")
        return api_error("Unable to dismiss this notification.", 500)
    finally:
        if cursor: cursor.close()
        if conn:
            try:
                if conn.is_connected(): conn.close()
            except Error: pass

