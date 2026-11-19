"""Shared database connection factory."""
import os
import mysql.connector
from config import BACKEND_DIR

def get_db_connection():
    """Create a MySQL connection using credentials from backend/.env."""
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "climentos_wmp"),
        charset="utf8mb4", use_unicode=True, connection_timeout=10, autocommit=False
    )
