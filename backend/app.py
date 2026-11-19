"""Flask application entry point for Climentos Work Management Platform."""
import os
from flask import Flask, redirect
from config import Config, PROJECT_ROOT

FRONTEND_DIR = PROJECT_ROOT / "frontend"

def create_app():
    app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
    app.config.from_object(Config)
    if not app.config["SECRET_KEY"]:
        raise RuntimeError("FLASK_SECRET_KEY is missing from backend/.env")

    from routes.auth_routes import AUTH_ROUTES_BP
    from routes.department_routes import DEPARTMENT_ROUTES_BP
    from routes.ticket_routes import TICKET_ROUTES_BP
    from routes.team_routes import TEAM_ROUTES_BP
    from routes.user_routes import USER_ROUTES_BP
    from routes.report_routes import REPORT_ROUTES_BP
    from routes.notification_routes import NOTIFICATION_ROUTES_BP
    from dashboard_routes import create_dashboard_blueprint
    from common import get_db_connection, roles_required, api_error
    from routes.profile_routes import PROFILE_ROUTES_BP

    @app.get("/")
    def home_page():
        return redirect("/pages/login.html")

    for blueprint in (AUTH_ROUTES_BP, DEPARTMENT_ROUTES_BP, TICKET_ROUTES_BP,
                      TEAM_ROUTES_BP, USER_ROUTES_BP, REPORT_ROUTES_BP,
                      NOTIFICATION_ROUTES_BP, PROFILE_ROUTES_BP):
        app.register_blueprint(blueprint)

    app.register_blueprint(create_dashboard_blueprint(
        get_db_connection=get_db_connection, roles_required=roles_required,
        api_error=api_error, logger=app.logger
    ))
    return app

app = create_app()

if __name__ == "__main__":
    print("CLIMENTOS WORK MANAGEMENT PLATFORM")
    print("Open http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")),
            debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
