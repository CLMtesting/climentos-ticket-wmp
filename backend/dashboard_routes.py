"""Role-aware dashboard API routes for Climentos WMP.

This module is registered by app.py. Database access and authentication
helpers are injected by the application to avoid circular imports.
"""

from datetime import date, timedelta

from flask import Blueprint, jsonify, request, session
from mysql.connector import Error
from ticket_scope import build_ticket_scope


def create_dashboard_blueprint(get_db_connection, roles_required, api_error, logger):
    dashboard_bp = Blueprint("dashboard", __name__)

    @dashboard_bp.get("/api/dashboard/summary")
    @roles_required("EMPLOYEE", "MANAGER", "ADMIN")
    def dashboard_summary():
        """Return role-scoped metrics, status distribution, activity and recent tickets."""
        conn = None
        cursor = None

        try:
            user = session["user"]
            role = str(user.get("role", "")).upper()
            user_id = int(user["id"])

            period = (request.args.get("period") or "month").lower()
            if period not in {"week", "month", "year"}:
                return api_error("Period must be week, month or year.", 400)

            scope_sql, scope_params = build_ticket_scope(role, user_id)

            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)

            cursor.execute(f"""
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(t.status = 'OPEN'), 0) AS open_count,
                    COALESCE(SUM(t.status = 'IN_PROGRESS'), 0) AS in_progress_count,
                    COALESCE(SUM(t.status = 'ON_HOLD'), 0) AS on_hold_count,
                    COALESCE(SUM(t.status = 'RESOLVED'), 0) AS resolved_count,
                    COALESCE(SUM(t.status = 'CLOSED'), 0) AS closed_count,
                    COALESCE(SUM(t.status = 'REJECTED'), 0) AS rejected_count,
                    COALESCE(SUM(t.assigned_to IS NULL), 0) AS unassigned_count
                FROM tickets AS t
                WHERE {scope_sql}
            """, tuple(scope_params))

            raw_stats = cursor.fetchone() or {}
            stats = {
                key: int(raw_stats.get(key) or 0)
                for key in (
                    "total", "open_count", "in_progress_count", "on_hold_count",
                    "resolved_count", "closed_count", "rejected_count",
                    "unassigned_count"
                )
            }

            cursor.execute(f"""
                SELECT
                    t.id, t.ticket_number, t.title, t.category, t.priority,
                    t.status, t.created_at, d.department_name,
                    creator.full_name AS created_by_name
                FROM tickets AS t
                LEFT JOIN departments AS d ON d.id = t.department_id
                LEFT JOIN users AS creator ON creator.id = t.created_by
                WHERE {scope_sql}
                ORDER BY t.created_at DESC, t.id DESC
                LIMIT 8
            """, tuple(scope_params))

            recent = cursor.fetchall()
            for row in recent:
                if row.get("created_at"):
                    row["created_at"] = row["created_at"].isoformat(sep=" ")

            # Use database-native DATE and MONTH buckets. This avoids string
            # formatting/escaping differences in MySQL Connector and keeps the
            # Python lookup keys consistent with the returned values.
            if period == "year":
                cursor.execute(f"""
                    SELECT MONTH(t.created_at) AS bucket, COUNT(*) AS raised
                    FROM tickets AS t
                    WHERE {scope_sql}
                      AND YEAR(t.created_at) = YEAR(CURDATE())
                    GROUP BY MONTH(t.created_at)
                    ORDER BY bucket ASC
                """, tuple(scope_params))
                raised_rows = cursor.fetchall()

                cursor.execute(f"""
                    SELECT MONTH(t.resolved_at) AS bucket, COUNT(*) AS resolved
                    FROM tickets AS t
                    WHERE {scope_sql}
                      AND t.resolved_at IS NOT NULL
                      AND YEAR(t.resolved_at) = YEAR(CURDATE())
                    GROUP BY MONTH(t.resolved_at)
                    ORDER BY bucket ASC
                """, tuple(scope_params))

                raised_map = {
                    int(row["bucket"]): int(row["raised"])
                    for row in raised_rows
                }
                resolved_map = {
                    int(row["bucket"]): int(row["resolved"])
                    for row in cursor.fetchall()
                }

                today = date.today()
                labels = [
                    date(today.year, month_number, 1).strftime("%b")
                    for month_number in range(1, 13)
                ]
                raised_values = [
                    raised_map.get(month_number, 0)
                    for month_number in range(1, 13)
                ]
                resolved_values = [
                    resolved_map.get(month_number, 0)
                    for month_number in range(1, 13)
                ]
            else:
                interval_days = 6 if period == "week" else 29
                cursor.execute(f"""
                    SELECT DATE(t.created_at) AS bucket, COUNT(*) AS raised
                    FROM tickets AS t
                    WHERE {scope_sql}
                      AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL {interval_days} DAY)
                    GROUP BY DATE(t.created_at)
                    ORDER BY bucket ASC
                """, tuple(scope_params))
                raised_rows = cursor.fetchall()

                cursor.execute(f"""
                    SELECT DATE(t.resolved_at) AS bucket, COUNT(*) AS resolved
                    FROM tickets AS t
                    WHERE {scope_sql}
                      AND t.resolved_at IS NOT NULL
                      AND t.resolved_at >= DATE_SUB(CURDATE(), INTERVAL {interval_days} DAY)
                    GROUP BY DATE(t.resolved_at)
                    ORDER BY bucket ASC
                """, tuple(scope_params))
                resolved_rows = cursor.fetchall()

                raised_map = {
                    str(row["bucket"]): int(row["raised"])
                    for row in raised_rows
                }
                resolved_map = {
                    str(row["bucket"]): int(row["resolved"])
                    for row in resolved_rows
                }

                today = date.today()
                days = 7 if period == "week" else 30
                labels, raised_values, resolved_values = [], [], []
                for offset in range(days - 1, -1, -1):
                    current_day = today - timedelta(days=offset)
                    key = current_day.isoformat()
                    labels.append(
                        current_day.strftime("%a" if period == "week" else "%d %b")
                    )
                    raised_values.append(raised_map.get(key, 0))
                    resolved_values.append(resolved_map.get(key, 0))

            distribution = [
                {"status": "OPEN", "label": "Open", "count": stats["open_count"]},
                {"status": "IN_PROGRESS", "label": "In Progress", "count": stats["in_progress_count"]},
                {"status": "ON_HOLD", "label": "On Hold", "count": stats["on_hold_count"]},
                {"status": "RESOLVED", "label": "Resolved", "count": stats["resolved_count"]},
                {"status": "CLOSED", "label": "Closed", "count": stats["closed_count"]},
                {"status": "REJECTED", "label": "Rejected", "count": stats["rejected_count"]},
            ]

            return jsonify({
                "success": True,
                "user": {
                    "id": user_id,
                    "name": user.get("name"),
                    "role": role
                },
                "scope": (
                    "PERSONAL" if role == "EMPLOYEE"
                    else "MANAGED_TEAMS" if role == "MANAGER"
                    else "ORGANIZATION"
                ),
                "stats": stats,
                "distribution": distribution,
                "activity": {
                    "period": period,
                    "labels": labels,
                    "raised": raised_values,
                    "resolved": resolved_values
                },
                "recent_tickets": recent
            }), 200

        except (Error, ValueError, TypeError):
            logger.exception("Dashboard summary retrieval failed")
            return api_error("Unable to load dashboard data from the database.", 500)

        finally:
            if cursor:
                cursor.close()
            if conn:
                try:
                    if conn.is_connected():
                        conn.close()
                except Error:
                    logger.warning("Error while closing dashboard database connection.")

    return dashboard_bp
