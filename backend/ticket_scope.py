"""Shared role-based ticket visibility rules for Climentos WMP."""
from typing import List, Tuple


def build_ticket_scope(role: str, user_id: int) -> Tuple[str, List[int]]:
    """Build a SQL predicate and parameters for the current user's ticket scope.

    Employees can see tickets they raised, tickets assigned directly to them,
    and tickets assigned to one of their active teams. Managers can additionally
    see tickets created by or assigned to their direct reports and managed-team
    members, plus tickets assigned to teams they manage. Admins see all tickets.
    """
    role = str(role or "").strip().upper()
    user_id = int(user_id)

    if role == "EMPLOYEE":
        return "t.created_by = %s", [user_id]

    if role == "MANAGER":
        return (
            """
            (
                t.created_by = %s
                OR t.assigned_to = %s
                OR t.team_id IN (
                    SELECT managed_team.id
                    FROM teams AS managed_team
                    WHERE managed_team.manager_id = %s
                      AND managed_team.is_active = TRUE
                )
                OR t.created_by IN (
                    SELECT direct_report.id
                    FROM users AS direct_report
                    WHERE direct_report.manager_id = %s
                      AND direct_report.is_active = TRUE
                )
                OR t.assigned_to IN (
                    SELECT direct_report.id
                    FROM users AS direct_report
                    WHERE direct_report.manager_id = %s
                      AND direct_report.is_active = TRUE
                )
                OR t.created_by IN (
                    SELECT team_member.user_id
                    FROM team_members AS team_member
                    INNER JOIN teams AS member_team
                        ON member_team.id = team_member.team_id
                    INNER JOIN users AS active_member
                        ON active_member.id = team_member.user_id
                    WHERE member_team.manager_id = %s
                      AND member_team.is_active = TRUE
                      AND active_member.is_active = TRUE
                )
                OR t.assigned_to IN (
                    SELECT team_member.user_id
                    FROM team_members AS team_member
                    INNER JOIN teams AS member_team
                        ON member_team.id = team_member.team_id
                    INNER JOIN users AS active_member
                        ON active_member.id = team_member.user_id
                    WHERE member_team.manager_id = %s
                      AND member_team.is_active = TRUE
                      AND active_member.is_active = TRUE
                )
            )
            """,
            [user_id] * 7,
        )

    if role == "ADMIN":
        return "1 = 1", []

    raise ValueError("Unsupported account role.")
