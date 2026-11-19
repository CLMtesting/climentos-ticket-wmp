from flask import Blueprint, current_app, jsonify, redirect, request, session
from mysql.connector import Error
from datetime import datetime, timedelta
from pathlib import Path
import os
import uuid
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from common import get_db_connection, api_error, login_required, roles_required, BACKEND_DIR
from ticket_scope import build_ticket_scope

REPORT_ROUTES_BP = Blueprint("report_routes", __name__)
bp = REPORT_ROUTES_BP

@bp.get("/api/reports/summary")
@roles_required("EMPLOYEE", "MANAGER", "ADMIN")
def reports_summary():
    """Return real ticket analytics within the authenticated user's ticket scope."""
    conn = None
    cursor = None
    try:
        current = session["user"]
        role = str(current.get("role", "")).upper()
        user_id = int(current["id"])

        period = (request.args.get("period") or "30").strip().lower()
        if period not in {"7", "30", "90", "all"}:
            return api_error("Period must be 7, 30, 90 or all.", 400)

        department_raw = (request.args.get("department_id") or "").strip()
        department_id = None
        if department_raw:
            try:
                department_id = int(department_raw)
                if department_id <= 0:
                    raise ValueError
            except ValueError:
                return api_error("Invalid department filter.", 400)

        scope_sql, scope_params = build_ticket_scope(role, user_id)
        conditions = [f"({scope_sql})"]
        params = list(scope_params)

        if period != "all":
            conditions.append("t.created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)")
            params.append(int(period) - 1)

        if department_id is not None:
            conditions.append("t.department_id = %s")
            params.append(department_id)

        where_sql = " AND ".join(conditions)

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Filter choices are based on departments represented in this user's
        # authorized ticket scope, independent of the selected date/department.
        cursor.execute(f"""
            SELECT DISTINCT d.id AS department_id, d.department_name
            FROM tickets t
            INNER JOIN departments d ON d.id = t.department_id
            WHERE ({scope_sql})
            ORDER BY d.department_name
        """, tuple(scope_params))
        department_options = cursor.fetchall()

        cursor.execute(f"""
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(t.status = 'OPEN'), 0) AS open_count,
                COALESCE(SUM(t.status = 'IN_PROGRESS'), 0) AS in_progress_count,
                COALESCE(SUM(t.status = 'ON_HOLD'), 0) AS on_hold_count,
                COALESCE(SUM(t.status = 'RESOLVED'), 0) AS resolved_count,
                COALESCE(SUM(t.status = 'CLOSED'), 0) AS closed_count,
                COALESCE(SUM(t.status = 'REJECTED'), 0) AS rejected_count
            FROM tickets t
            WHERE {where_sql}
        """, tuple(params))
        raw = cursor.fetchone() or {}
        stats = {key: int(raw.get(key) or 0) for key in (
            "total", "open_count", "in_progress_count", "on_hold_count",
            "resolved_count", "closed_count", "rejected_count"
        )}
        stats["resolved_total"] = stats["resolved_count"] + stats["closed_count"]
        stats["pending_total"] = stats["total"] - stats["resolved_total"]
        stats["resolution_rate"] = round(
            (stats["resolved_total"] / stats["total"]) * 100
        ) if stats["total"] else 0

        cursor.execute(f"""
            SELECT t.status, COUNT(*) AS count
            FROM tickets t
            WHERE {where_sql}
            GROUP BY t.status
            ORDER BY FIELD(t.status, 'OPEN','IN_PROGRESS','ON_HOLD','RESOLVED','CLOSED','REJECTED')
        """, tuple(params))
        status_rows = cursor.fetchall()

        cursor.execute(f"""
            SELECT t.priority, COUNT(*) AS count
            FROM tickets t
            WHERE {where_sql}
            GROUP BY t.priority
            ORDER BY FIELD(t.priority, 'URGENT','HIGH','MEDIUM','LOW')
        """, tuple(params))
        priority_rows = cursor.fetchall()

        cursor.execute(f"""
            SELECT
                d.id AS department_id,
                COALESCE(d.department_name, 'Unassigned') AS department_name,
                COUNT(t.id) AS total,
                COALESCE(SUM(t.status IN ('RESOLVED','CLOSED')), 0) AS resolved
            FROM tickets t
            LEFT JOIN departments d ON d.id = t.department_id
            WHERE {where_sql}
            GROUP BY d.id, d.department_name
            ORDER BY total DESC, department_name ASC
        """, tuple(params))
        department_rows = cursor.fetchall()

        # Daily buckets for short periods; monthly buckets for 90 days/all time.
        if period in {"7", "30"}:
            bucket_expr = "DATE_FORMAT(t.created_at, '%Y-%m-%d')"
            resolved_bucket_expr = "DATE_FORMAT(t.resolved_at, '%Y-%m-%d')"
            trend_condition = (
                "t.created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)"
                if period == "7" else
                "t.created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)"
            )
            trend_params = list(scope_params)
            trend_conditions = [f"({scope_sql})"]
            if period != "all":
                trend_conditions.append(trend_condition)
                trend_params.append(int(period) - 1)
            if department_id is not None:
                trend_conditions.append("t.department_id = %s")
                trend_params.append(department_id)
            trend_where = " AND ".join(trend_conditions)
            cursor.execute(f"""
                SELECT {bucket_expr} AS bucket, COUNT(*) AS count
                FROM tickets t WHERE {trend_where}
                GROUP BY bucket ORDER BY bucket
            """, tuple(trend_params))
            created_trend = cursor.fetchall()

            resolved_conditions = [f"({scope_sql})", "t.resolved_at IS NOT NULL",
                "t.resolved_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)"]
            resolved_params = list(scope_params) + [int(period) - 1]
            if department_id is not None:
                resolved_conditions.append("t.department_id = %s")
                resolved_params.append(department_id)
            cursor.execute(f"""
                SELECT {resolved_bucket_expr} AS bucket, COUNT(*) AS count
                FROM tickets t WHERE {" AND ".join(resolved_conditions)}
                GROUP BY bucket ORDER BY bucket
            """, tuple(resolved_params))
            resolved_trend = cursor.fetchall()
        else:
            cursor.execute(f"""
                SELECT DATE_FORMAT(t.created_at, '%Y-%m') AS bucket, COUNT(*) AS count
                FROM tickets t WHERE {where_sql}
                GROUP BY bucket ORDER BY bucket
            """, tuple(params))
            created_trend = cursor.fetchall()
            resolved_conditions = [f"({scope_sql})", "t.resolved_at IS NOT NULL"]
            resolved_params = list(scope_params)
            if period != "all":
                resolved_conditions.append("t.resolved_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)")
                resolved_params.append(int(period) - 1)
            if department_id is not None:
                resolved_conditions.append("t.department_id = %s")
                resolved_params.append(department_id)
            cursor.execute(f"""
                SELECT DATE_FORMAT(t.resolved_at, '%Y-%m') AS bucket, COUNT(*) AS count
                FROM tickets t WHERE {" AND ".join(resolved_conditions)}
                GROUP BY bucket ORDER BY bucket
            """, tuple(resolved_params))
            resolved_trend = cursor.fetchall()

        created_map = {str(row["bucket"]): int(row["count"]) for row in created_trend}
        resolved_map = {str(row["bucket"]): int(row["count"]) for row in resolved_trend}
        bucket_keys = sorted(set(created_map) | set(resolved_map))
        trend = [{
            "label": key,
            "created": created_map.get(key, 0),
            "resolved": resolved_map.get(key, 0)
        } for key in bucket_keys]

        return jsonify({
            "success": True,
            "user": {"id": user_id, "name": current.get("name"), "role": role},
            "scope": "PERSONAL" if role == "EMPLOYEE" else (
                "MANAGED_TEAMS_AND_DIRECT_REPORTS" if role == "MANAGER" else "ORGANIZATION"
            ),
            "filters": {"period": period, "department_id": department_id},
            "stats": stats,
            "statuses": status_rows,
            "priorities": priority_rows,
            "departments": department_rows,
            "department_options": department_options,
            "trend": trend
        }), 200

    except (Error, ValueError, TypeError):
        current_app.logger.exception("Reports & Analytics retrieval failed")
        return api_error("Unable to load reports from the database.", 500)
    finally:
        if cursor:
            cursor.close()
        if conn:
            try:
                if conn.is_connected():
                    conn.close()
            except Error:
                current_app.logger.warning("Error while closing Reports database connection.")

