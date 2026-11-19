
"""Create development-only demo accounts."""

import os
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash


# Load backend/.env regardless of the current working directory.
BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

# Read database configuration from environment variables.
required_vars = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]

missing = [key for key in required_vars if not os.getenv(key)]

if missing:
    raise RuntimeError(
        f"Missing environment variables in backend/.env: {', '.join(missing)}"
    )

conn = None
cur = None

try:
    conn = mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
        charset="utf8mb4",
        use_unicode=True
    )

    cur = conn.cursor()

    # Ensure the General department exists.
    cur.execute(
        """
        INSERT IGNORE INTO departments
            (department_name, description)
        VALUES (%s, %s)
        """,
        ("General", "Default department for initial setup")
    )

    cur.execute(
        "SELECT id FROM departments WHERE department_name = %s",
        ("General",)
    )

    department = cur.fetchone()

    if not department:
        raise RuntimeError("General department could not be found.")

    department_id = department[0]

    # Development-only demo accounts.
    accounts = [
        ("Demo User", "user@gmail.com", "user", "EMPLOYEE"),
        ("Piyush", "piyush@gmail.com", "user1", "MANAGER"),
        ("Sharath Chandra", "sharathchandra@gmail.com", "user2", "ADMIN")
    ]

    for name, email, password, role in accounts:

        cur.execute(
            "SELECT id FROM roles WHERE role_name = %s",
            (role,)
        )

        role_record = cur.fetchone()

        if not role_record:
            raise RuntimeError(f"Role {role} is missing from the roles table.")

        role_id = role_record[0]
        password_hash = generate_password_hash(password)

        cur.execute(
            """
            INSERT INTO users (
                full_name,
                email,
                password_hash,
                role_id,
                department_id,
                is_active
            )
            VALUES (%s, %s, %s, %s, %s, 1)
            ON DUPLICATE KEY UPDATE
                full_name = VALUES(full_name),
                password_hash = VALUES(password_hash),
                role_id = VALUES(role_id),
                department_id = VALUES(department_id),
                is_active = 1
            """,
            (
                name,
                email,
                password_hash,
                role_id,
                department_id
            )
        )

    conn.commit()

    print("Demo accounts created/updated successfully.")
    print("Employee: user@gmail.com / user")
    print("Manager : piyush@gmail.com / user1")
    print("Admin   : sharathchandra@gmail.com / user2")

except Exception:
    if conn and conn.is_connected():
        conn.rollback()
    raise

finally:
    if cur:
        cur.close()

    if conn and conn.is_connected():
        conn.close()
