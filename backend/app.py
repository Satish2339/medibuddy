import os
import re
import secrets
import hashlib
import hmac
import smtplib
import ssl
import threading
import time
from datetime import date, datetime, time as time_type, timedelta, timezone
from email.message import EmailMessage
from functools import wraps
from pathlib import Path

import jwt
from flask import Flask, g, jsonify, request
from flask.json.provider import DefaultJSONProvider
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_connection


BASE_DIR = Path(__file__).resolve().parent


class AppointmentJSONProvider(DefaultJSONProvider):
    def default(self, value):
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, date):
            return value.isoformat()
        if isinstance(value, time_type):
            return value.isoformat()
        return super().default(value)


class MedibuddyFlask(Flask):
    json_provider_class = AppointmentJSONProvider


app = MedibuddyFlask(
    __name__,
    static_folder=str(BASE_DIR.parent / "frontend"),
    static_url_path="",
)
app.config["JWT_SECRET"] = os.getenv("JWT_SECRET") or secrets.token_urlsafe(48)
app.config["ADMIN_USERNAME"] = os.getenv("ADMIN_USERNAME", "admin").strip() or "admin"
app.config["ADMIN_PASSWORD"] = os.getenv("ADMIN_PASSWORD", "")
app.config["CORS_ORIGINS"] = {
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",")
    if origin.strip()
}
JWT_ISSUER = "medibuddy"
ADMIN_JWT_ISSUER = "medibuddy-admin"
admin_login_attempts = {}
admin_login_lock = threading.Lock()


@app.get("/")
def home():
    return app.send_static_file("index.html")


def json_response(payload, status=200):
    response = jsonify(payload)
    response.status_code = status
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
    return response


@app.after_request
def apply_cors(response):
    origin = request.headers.get("Origin")
    if origin in app.config["CORS_ORIGINS"]:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def options_handler(_path):
    return json_response({"ok": True})


def fetch_all(query, params=None):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            return cur.fetchall()


def fetch_one(query, params=None):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            return cur.fetchone()


def execute_query(query, params=None, fetch=False):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            row = cur.fetchone() if fetch else None
        conn.commit()
    return row


def patient_required(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return json_response({"error": "Sign in is required"}, 401)
        try:
            claims = jwt.decode(
                token,
                app.config["JWT_SECRET"],
                algorithms=["HS256"],
                issuer=JWT_ISSUER,
            )
            patient_id = int(claims["sub"])
        except (jwt.PyJWTError, KeyError, TypeError, ValueError):
            return json_response({"error": "Your session is invalid or expired. Please sign in again."}, 401)

        g.patient = fetch_one(
            "SELECT id, full_name, email, phone, age, gender FROM patients WHERE id = %s",
            (patient_id,),
        )
        if not g.patient:
            return json_response({"error": "Patient account not found"}, 401)
        return handler(*args, **kwargs)

    return wrapped


def admin_required(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return json_response({"error": "Administrator sign-in is required"}, 401)
        try:
            claims = jwt.decode(
                token,
                app.config["JWT_SECRET"],
                algorithms=["HS256"],
                issuer=ADMIN_JWT_ISSUER,
            )
            if claims.get("role") != "admin" or not hmac.compare_digest(
                str(claims.get("sub", "")), app.config["ADMIN_USERNAME"]
            ):
                raise jwt.InvalidTokenError("Invalid administrator role")
        except jwt.PyJWTError:
            return json_response({"error": "Administrator session is invalid or expired. Sign in again."}, 401)
        return handler(*args, **kwargs)

    return wrapped


def issue_patient_token(patient_id):
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(patient_id), "iss": JWT_ISSUER, "iat": now, "exp": now + timedelta(hours=12)},
        app.config["JWT_SECRET"],
        algorithm="HS256",
    )


def issue_admin_token(username):
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": username,
            "role": "admin",
            "iss": ADMIN_JWT_ISSUER,
            "iat": now,
            "exp": now + timedelta(hours=8),
        },
        app.config["JWT_SECRET"],
        algorithm="HS256",
    )


def generate_email_otp(email, purpose):
    code = f"{secrets.randbelow(1_000_000):06d}"
    digest = hmac.new(
        app.config["JWT_SECRET"].encode("utf-8"),
        f"{purpose}:{email}:{code}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return code, digest


def otp_matches(email, purpose, code, expected_digest):
    supplied_digest = hmac.new(
        app.config["JWT_SECRET"].encode("utf-8"),
        f"{purpose}:{email}:{code}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(supplied_digest, expected_digest)


def send_email_otp(email, purpose, code):
    host = os.getenv("SMTP_HOST")
    username = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM")
    if not all((host, username, password, sender)):
        raise RuntimeError("SMTP email settings are incomplete")

    message = EmailMessage()
    message["Subject"] = "Medibuddy email verification code"
    message["From"] = sender
    message["To"] = email
    purpose_label = {
        "register": "registration",
        "login": "sign-in",
        "reset": "password reset",
    }.get(purpose, "verification")
    message.set_content(
        f"Your Medibuddy {purpose_label} code is {code}. "
        "It expires in 10 minutes. If you did not request this code, ignore this message."
    )

    port = int(os.getenv("SMTP_PORT", "587"))
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    if use_ssl:
        server_context = smtplib.SMTP_SSL(host, port, timeout=15, context=ssl.create_default_context())
    else:
        server_context = smtplib.SMTP(host, port, timeout=15)
    with server_context as server:
        if not use_ssl:
            server.starttls(context=ssl.create_default_context())
        server.login(username, password)
        server.send_message(message)


def email_otp_configured():
    required = {key: os.getenv(key, "").strip() for key in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM")}
    placeholder_values = {
        "smtp.example.com",
        "your-smtp-user",
        "your-smtp-app-password",
        "no-reply@example.com",
        "replace_with_new_google_app_password",
    }
    return all(value and value.lower() not in placeholder_values for value in required.values())


def initialize_database():
    schema = (BASE_DIR / "schema.sql").read_text(encoding="utf-8")
    statements = [statement.strip() for statement in schema.split(";") if statement.strip()]
    with get_connection() as conn:
        with conn.cursor() as cur:
            for statement in statements:
                cur.execute(statement)
            cur.execute("ALTER TABLE patients ADD COLUMN IF NOT EXISTS password_hash TEXT")
        conn.commit()
    seed_database()


def seed_database():
    departments = [
        ("Cardiology", "Heart care, ECG tracking, and preventive consultation.", "#ff6b6b"),
        ("Neurology", "Brain, spine, and migraine assessment with digital case history.", "#6c63ff"),
        ("Pediatrics", "Child wellness, vaccines, and family-friendly follow up.", "#00b894"),
        ("Orthopedics", "Bone, joint, rehab, and sports injury appointments.", "#f39c12"),
    ]
    doctors = [
        ("Dr. Aanya Kapoor", "Cardiologist", 11, 900, 4.9, "Mon-Fri | 09:00-15:00", 1, "sunrise-wave", "Focuses on preventive heart health and rapid diagnostics."),
        ("Dr. Rohan Mehta", "Neurologist", 9, 1100, 4.8, "Tue-Sat | 10:00-17:00", 2, "aurora-grid", "Specializes in migraine, sleep disorder, and stroke follow-ups."),
        ("Dr. Meera Iyer", "Pediatrician", 13, 800, 4.9, "Mon-Sat | 08:00-14:00", 3, "mint-bloom", "Known for calm consultations and vaccination planning."),
        ("Dr. Karan Sethi", "Orthopedic Surgeon", 15, 1200, 4.7, "Mon-Fri | 11:00-18:00", 4, "amber-flow", "Handles fracture recovery, knee pain, and physiotherapy plans."),
    ]
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS count FROM departments")
            if cur.fetchone()["count"] == 0:
                cur.executemany(
                    "INSERT INTO departments (name, description, accent_color) VALUES (%s, %s, %s)",
                    departments,
                )

            cur.execute("SELECT COUNT(*) AS count FROM doctors")
            if cur.fetchone()["count"] == 0:
                cur.executemany(
                    """
                    INSERT INTO doctors (
                        full_name, specialty, experience_years, consultation_fee, rating,
                        availability, department_id, avatar_gradient, bio
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    doctors,
                )

            cur.execute("SELECT COUNT(*) AS count FROM appointments")
            if cur.fetchone()["count"] == 0:
                cur.execute(
                    """
                    INSERT INTO patients (full_name, email, phone, age, gender)
                    VALUES
                        ('Aarav Sharma', 'aarav@example.com', '9876543210', 29, 'Male'),
                        ('Siya Nair', 'siya@example.com', '9123456789', 34, 'Female')
                    ON CONFLICT (email) DO NOTHING
                    """
                )
                cur.execute(
                    """
                    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, reason, status, mode)
                    SELECT p.id, d.id, CURRENT_DATE + INTERVAL '1 day', TIME '10:30', 'Routine check-up', 'Scheduled', 'In-person'
                    FROM patients p CROSS JOIN doctors d
                    WHERE p.email = 'aarav@example.com' AND d.full_name = 'Dr. Aanya Kapoor'
                    LIMIT 1
                    """
                )
                cur.execute(
                    """
                    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, reason, status, mode)
                    SELECT p.id, d.id, CURRENT_DATE + INTERVAL '2 day', TIME '14:15', 'Follow-up consultation', 'Confirmed', 'Video'
                    FROM patients p CROSS JOIN doctors d
                    WHERE p.email = 'siya@example.com' AND d.full_name = 'Dr. Rohan Mehta'
                    LIMIT 1
                    """
                )
                cur.execute(
                    """
                    INSERT INTO notifications (audience, audience_id, title, message)
                    VALUES
                        ('admin', NULL, 'Morning brief ready', '2 new appointments were placed for review.'),
                        ('doctor', 1, 'Upcoming consultation', 'Aarav Sharma is booked for tomorrow at 10:30 AM.')
                    """
                )
        conn.commit()


@app.route("/api/health", methods=["GET"])
def health():
    return json_response({"status": "ok", "date": datetime.now().isoformat()})


@app.route("/api/auth/admin/login", methods=["POST"])
def admin_login():
    configured_password = app.config["ADMIN_PASSWORD"]
    if not configured_password:
        return json_response(
            {"error": "Admin password is not configured. Set ADMIN_PASSWORD in backend/.env and restart the API."},
            503,
        )
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return json_response({"error": "Enter your administrator username and password"}, 400)
    username = payload.get("username", "")
    password = payload.get("password", "")
    if not isinstance(username, str) or not isinstance(password, str):
        return json_response({"error": "Enter your administrator username and password"}, 400)

    client_ip = request.remote_addr or "unknown"
    now = time.monotonic()
    with admin_login_lock:
        recent_attempts = [attempt for attempt in admin_login_attempts.get(client_ip, []) if now - attempt < 900]
        if len(recent_attempts) >= 5:
            admin_login_attempts[client_ip] = recent_attempts
            return json_response({"error": "Too many sign-in attempts. Try again in 15 minutes."}, 429)

        valid_username = hmac.compare_digest(username, app.config["ADMIN_USERNAME"])
        valid_password = hmac.compare_digest(password, configured_password)
        if not (valid_username and valid_password):
            recent_attempts.append(now)
            admin_login_attempts[client_ip] = recent_attempts
            return json_response({"error": "Administrator username or password is incorrect"}, 401)

        admin_login_attempts.pop(client_ip, None)
    return json_response({"message": "Administrator signed in", "token": issue_admin_token(username), "expiresInSeconds": 28800})


@app.route("/api/auth/register", methods=["POST"])
def register_patient():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return json_response({"error": "Request body must be a JSON object"}, 400)
    if any(not isinstance(payload.get(key, ""), str) for key in ("fullName", "email", "phone", "gender", "password")):
        return json_response({"error": "Registration fields must be text"}, 400)
    full_name = str(payload.get("fullName", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    phone = str(payload.get("phone", "")).strip()
    gender = str(payload.get("gender", "")).strip()
    password = payload.get("password", "")
    try:
        age = int(payload.get("age", 0))
    except (TypeError, ValueError):
        age = 0

    if not full_name or len(full_name) > 120:
        return json_response({"error": "Enter a name with at most 120 characters"}, 400)
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 160:
        return json_response({"error": "Enter a valid email address"}, 400)
    if not phone or len(phone) > 30 or age < 1 or age > 120 or gender not in {"Male", "Female", "Other"}:
        return json_response({"error": "Enter a valid phone, age, and gender"}, 400)
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        return json_response({"error": "Password must be between 8 and 128 characters"}, 400)

    if not email_otp_configured():
        return json_response({"error": "Email verification is not configured. Add real SMTP details to backend/.env and replace SMTP_PASSWORD=REPLACE_WITH_NEW_GOOGLE_APP_PASSWORD with your newly generated Google App Password. Restart the API afterward."}, 503)

    otp, otp_digest = generate_email_otp(email, "register")
    password_hash = generate_password_hash(password)
    now = datetime.now(timezone.utc)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM patients WHERE email = %s", (email,))
            if cur.fetchone():
                return json_response({"error": "An account or legacy patient record already uses this email"}, 409)
            cur.execute(
                """
                INSERT INTO pending_patient_registrations (
                    email, full_name, phone, age, gender, password_hash, otp_hash, expires_at, attempts, sent_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 0, CURRENT_TIMESTAMP)
                ON CONFLICT (email) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    phone = EXCLUDED.phone,
                    age = EXCLUDED.age,
                    gender = EXCLUDED.gender,
                    password_hash = EXCLUDED.password_hash,
                    otp_hash = EXCLUDED.otp_hash,
                    expires_at = EXCLUDED.expires_at,
                    attempts = 0,
                    sent_at = CURRENT_TIMESTAMP
                WHERE pending_patient_registrations.sent_at <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
                RETURNING email
                """,
                (email, full_name, phone, age, gender, password_hash, otp_digest, now + timedelta(minutes=10)),
            )
            if not cur.fetchone():
                return json_response({"error": "Please wait 60 seconds before requesting another code"}, 429)
        conn.commit()

    try:
        send_email_otp(email, "register", otp)
    except (OSError, smtplib.SMTPException, RuntimeError, ValueError) as error:
        app.logger.warning("Registration verification email failed (%s): %s", type(error).__name__, error)
        return json_response({"error": "Could not send the verification email. Check the SMTP settings and try again."}, 503)
    return json_response({"message": "Verification code sent to your email", "email": email, "expiresInSeconds": 600}, 202)


@app.route("/api/auth/register/verify-otp", methods=["POST"])
def verify_registration_otp():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return json_response({"error": "Request body must be a JSON object"}, 400)
    if any(not isinstance(payload.get(key, ""), str) for key in ("email", "otp")):
        return json_response({"error": "Email and verification code must be text"}, 400)
    email = str(payload.get("email", "")).strip().lower()
    otp = str(payload.get("otp", "")).strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not re.fullmatch(r"\d{6}", otp):
        return json_response({"error": "Enter the registered email and six-digit code"}, 400)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM pending_patient_registrations WHERE email = %s FOR UPDATE", (email,))
            pending = cur.fetchone()
            if not pending:
                return json_response({"error": "Code expired or registration was not found. Request a new code."}, 400)
            if pending["expires_at"] <= datetime.now(timezone.utc):
                cur.execute("DELETE FROM pending_patient_registrations WHERE email = %s", (email,))
                conn.commit()
                return json_response({"error": "Code expired. Request a new code."}, 400)
            if pending["attempts"] >= 5:
                return json_response({"error": "Too many incorrect codes. Request a new code later."}, 429)
            if not otp_matches(email, "register", otp, pending["otp_hash"]):
                cur.execute("UPDATE pending_patient_registrations SET attempts = attempts + 1 WHERE email = %s", (email,))
                conn.commit()
                return json_response({"error": "The verification code is incorrect"}, 400)
            cur.execute(
                """
                INSERT INTO patients (full_name, email, phone, age, gender, password_hash)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (email) DO NOTHING
                RETURNING id, full_name, email, phone, age, gender
                """,
                (pending["full_name"], email, pending["phone"], pending["age"], pending["gender"], pending["password_hash"]),
            )
            patient = cur.fetchone()
            if not patient:
                cur.execute("DELETE FROM pending_patient_registrations WHERE email = %s", (email,))
                conn.commit()
                return json_response({"error": "An account or patient record already uses this email"}, 409)
            cur.execute("DELETE FROM pending_patient_registrations WHERE email = %s", (email,))
        conn.commit()
    return json_response({"message": "Account verified and created", "token": issue_patient_token(patient["id"]), "patient": patient}, 201)


@app.route("/api/auth/login", methods=["POST"])
def login_patient():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return json_response({"error": "Request body must be a JSON object"}, 400)
    email = str(payload.get("email", "")).strip().lower()
    password = payload.get("password", "")
    if not isinstance(payload.get("email", ""), str) or not isinstance(password, str) or len(password) > 128:
        return json_response({"error": "Enter a valid email and password"}, 400)
    patient = fetch_one(
        "SELECT id, full_name, email, phone, age, gender, password_hash FROM patients WHERE email = %s",
        (email,),
    )
    if not patient or not patient["password_hash"] or not isinstance(password, str) or not check_password_hash(patient["password_hash"], password):
        return json_response({"error": "Email or password is incorrect"}, 401)
    patient_data = {key: patient[key] for key in ("id", "full_name", "email", "phone", "age", "gender")}
    return json_response({"message": "Signed in", "token": issue_patient_token(patient["id"]), "patient": patient_data})


@app.route("/api/auth/forgot-password", methods=["POST"])
def request_password_reset():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict) or not isinstance(payload.get("email", ""), str):
        return json_response({"error": "Enter a valid email address"}, 400)
    email = payload.get("email", "").strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 160:
        return json_response({"error": "Enter a valid email address"}, 400)
    if not email_otp_configured():
        return json_response({"error": "Email verification is not configured. Add real SMTP details to backend/.env and restart the API."}, 503)

    patient = fetch_one("SELECT id FROM patients WHERE email = %s AND password_hash IS NOT NULL", (email,))
    generic_response = {
        "message": "If an account exists for this email, a password reset code has been sent.",
        "email": email,
        "expiresInSeconds": 600,
    }
    if not patient:
        return json_response(generic_response, 202)

    otp, otp_digest = generate_email_otp(email, "reset")
    now = datetime.now(timezone.utc)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sent_at FROM auth_otp_challenges WHERE email = %s AND purpose = 'reset' FOR UPDATE",
                (email,),
            )
            previous = cur.fetchone()
            if previous and previous["sent_at"] > now - timedelta(seconds=60):
                return json_response(generic_response, 202)
            cur.execute(
                """
                INSERT INTO auth_otp_challenges (email, purpose, otp_hash, expires_at, attempts, sent_at)
                VALUES (%s, 'reset', %s, %s, 0, CURRENT_TIMESTAMP)
                ON CONFLICT (email, purpose) DO UPDATE SET
                    otp_hash = EXCLUDED.otp_hash,
                    expires_at = EXCLUDED.expires_at,
                    attempts = 0,
                    sent_at = CURRENT_TIMESTAMP
                """,
                (email, otp_digest, now + timedelta(minutes=10)),
            )
        conn.commit()

    try:
        send_email_otp(email, "reset", otp)
    except (OSError, smtplib.SMTPException, RuntimeError, ValueError):
        app.logger.warning("Password reset email delivery failed")
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM auth_otp_challenges WHERE email = %s AND purpose = 'reset'", (email,))
            conn.commit()
    return json_response(generic_response, 202)


@app.route("/api/auth/reset-password", methods=["POST"])
def reset_password():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict) or any(
        not isinstance(payload.get(key, ""), str) for key in ("email", "otp", "password")
    ):
        return json_response({"error": "Email, verification code, and password must be text"}, 400)
    email = payload.get("email", "").strip().lower()
    otp = payload.get("otp", "").strip()
    password = payload.get("password", "")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not re.fullmatch(r"\d{6}", otp):
        return json_response({"error": "Enter the email and six-digit reset code"}, 400)
    if len(password) < 8 or len(password) > 128:
        return json_response({"error": "Password must be between 8 and 128 characters"}, 400)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM auth_otp_challenges WHERE email = %s AND purpose = 'reset' FOR UPDATE",
                (email,),
            )
            challenge = cur.fetchone()
            if not challenge:
                return json_response({"error": "Reset code expired or not found. Request a new code."}, 400)
            if challenge["expires_at"] <= datetime.now(timezone.utc):
                cur.execute("DELETE FROM auth_otp_challenges WHERE email = %s AND purpose = 'reset'", (email,))
                conn.commit()
                return json_response({"error": "Reset code expired. Request a new code."}, 400)
            if challenge["attempts"] >= 5:
                return json_response({"error": "Too many incorrect codes. Request a new reset code later."}, 429)
            if not otp_matches(email, "reset", otp, challenge["otp_hash"]):
                cur.execute(
                    "UPDATE auth_otp_challenges SET attempts = attempts + 1 WHERE email = %s AND purpose = 'reset'",
                    (email,),
                )
                conn.commit()
                return json_response({"error": "The reset code is incorrect"}, 400)
            cur.execute(
                "UPDATE patients SET password_hash = %s WHERE email = %s RETURNING id",
                (generate_password_hash(password), email),
            )
            patient = cur.fetchone()
            cur.execute("DELETE FROM auth_otp_challenges WHERE email = %s AND purpose = 'reset'", (email,))
            cur.execute("DELETE FROM auth_otp_challenges WHERE email = %s AND purpose = 'login'", (email,))
        conn.commit()
    if not patient:
        return json_response({"error": "Patient account not found"}, 404)
    return json_response({"message": "Password reset successfully. You can now sign in."})


@app.route("/api/auth/me", methods=["GET"])
@patient_required
def current_patient():
    return json_response({"patient": g.patient})


@app.route("/api/auth/logout", methods=["POST"])
@patient_required
def logout_patient():
    # JWT sessions are stateless; the client discards its token on logout.
    return json_response({"message": "Signed out"})


@app.route("/api/overview", methods=["GET"])
def overview():
    stats = fetch_one(
        """
        SELECT
            (SELECT COUNT(*) FROM doctors) AS doctors,
            (SELECT COUNT(*) FROM departments) AS departments,
            (SELECT COUNT(*) FROM appointments) AS appointments,
            (SELECT COUNT(*) FROM appointments WHERE status IN ('Scheduled', 'Confirmed')) AS upcoming
        """
    )
    departments = fetch_all("SELECT * FROM departments ORDER BY name")
    featured_doctors = fetch_all(
        """
        SELECT d.id, d.full_name, d.specialty, d.experience_years, d.consultation_fee,
               d.rating, d.availability, d.avatar_gradient, d.bio, dept.name AS department
        FROM doctors d
        LEFT JOIN departments dept ON dept.id = d.department_id
        ORDER BY d.rating DESC, d.full_name ASC
        LIMIT 4
        """
    )
    return json_response({"stats": stats, "departments": departments, "featuredDoctors": featured_doctors})


@app.route("/api/doctors", methods=["GET"])
def doctors():
    specialty = request.args.get("specialty")
    query = """
        SELECT d.id, d.full_name, d.specialty, d.experience_years, d.consultation_fee, d.rating,
               d.availability, d.avatar_gradient, d.bio, dept.name AS department, dept.accent_color
        FROM doctors d
        LEFT JOIN departments dept ON dept.id = d.department_id
    """
    params = []
    if specialty:
        query += " WHERE d.specialty = %s"
        params.append(specialty)
    query += " ORDER BY d.full_name ASC"
    return json_response(fetch_all(query, params))


@app.route("/api/appointments", methods=["GET"])
@admin_required
def appointments():
    doctor_id = request.args.get("doctor_id")
    query = """
         SELECT a.id, a.appointment_date, a.appointment_time, a.reason, a.status, a.mode, a.created_at,
               p.full_name AS patient_name, p.email, p.phone, p.age, p.gender,
             d.full_name AS doctor_name, d.specialty, dept.name AS department, d.consultation_fee
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
         LEFT JOIN departments dept ON dept.id = d.department_id
    """
    params = []
    if doctor_id:
        query += " WHERE a.doctor_id = %s"
        params.append(doctor_id)
    query += " ORDER BY a.appointment_date ASC, a.appointment_time ASC"
    return json_response(fetch_all(query, params))


@app.route("/api/appointments", methods=["POST"])
@patient_required
def create_appointment():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return json_response({"error": "Request body must be a JSON object"}, 400)
    required = ["doctorId", "appointmentDate", "appointmentTime", "reason", "mode"]
    missing = [field for field in required if not payload.get(field)]
    if missing:
        return json_response({"error": f"Missing fields: {', '.join(missing)}"}, 400)

    try:
        doctor_id = int(payload["doctorId"])
    except (TypeError, ValueError):
        return json_response({"error": "Choose a valid doctor"}, 400)
    try:
        appointment_date = date.fromisoformat(str(payload["appointmentDate"]))
        appointment_time_value = str(payload["appointmentTime"])
        time_format = "%H:%M:%S" if re.fullmatch(r"\d{2}:\d{2}:\d{2}", appointment_time_value) else "%H:%M"
        if not re.fullmatch(r"\d{2}:\d{2}(?::\d{2})?", appointment_time_value):
            raise ValueError("invalid time format")
        appointment_time = datetime.strptime(appointment_time_value, time_format).time()
    except ValueError:
        return json_response({"error": "Enter a valid appointment date and time"}, 400)
    if appointment_date < date.today():
        return json_response({"error": "Appointment date cannot be in the past"}, 400)
    reason = str(payload["reason"]).strip()
    mode = str(payload["mode"])
    if not reason or len(reason) > 2000 or mode not in {"In-person", "Video", "Phone"}:
        return json_response({"error": "Enter a visit reason and valid appointment mode"}, 400)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM doctors WHERE id = %s", (doctor_id,))
            if not cur.fetchone():
                return json_response({"error": "Doctor not found"}, 404)
            cur.execute(
                """
                INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, reason, status, mode)
                VALUES (%s, %s, %s, %s, %s, 'Scheduled', %s)
                RETURNING id
                """,
                (g.patient["id"], doctor_id, appointment_date, appointment_time, reason, mode),
            )
            appointment_id = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO notifications (audience, audience_id, title, message)
                VALUES
                    ('admin', NULL, 'New appointment booked', %s),
                    ('doctor', %s, 'New patient booking', %s),
                    ('patient', %s, 'Appointment request received', %s)
                """,
                (
                    f"{g.patient['full_name']} booked {appointment_date.isoformat()} at {appointment_time.strftime('%H:%M')}.",
                    doctor_id,
                    f"Please review {g.patient['full_name']}'s appointment request.",
                    g.patient["id"],
                    f"Your request with appointment ID {appointment_id} is scheduled and awaiting confirmation.",
                ),
            )
        conn.commit()

    return json_response({"message": "Appointment booked successfully", "appointmentId": appointment_id}, 201)


@app.route("/api/appointments/<int:appointment_id>/status", methods=["PATCH"])
@admin_required
def update_appointment_status(appointment_id):
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return json_response({"error": "Request body must be a JSON object"}, 400)
    new_status = payload.get("status")
    if new_status not in {"Scheduled", "Confirmed", "Completed", "Cancelled"}:
        return json_response({"error": "Invalid status"}, 400)

    row = execute_query(
        "UPDATE appointments SET status = %s WHERE id = %s RETURNING id, patient_id",
        (new_status, appointment_id),
        fetch=True,
    )
    if not row:
        return json_response({"error": "Appointment not found"}, 404)
    execute_query(
        "INSERT INTO notifications (audience, audience_id, title, message) VALUES ('patient', %s, %s, %s)",
        (row["patient_id"], "Appointment status updated", f"Your appointment {appointment_id} is now {new_status.lower()}."),
    )
    return json_response({"message": "Appointment status updated"})


@app.route("/api/calendar", methods=["GET"])
def calendar():
    month = request.args.get("month") or date.today().strftime("%Y-%m")
    items = fetch_all(
        """
        SELECT
            TO_CHAR(a.appointment_date, 'YYYY-MM-DD') AS day,
            COUNT(*) AS total,
            SUM(CASE WHEN a.status IN ('Scheduled', 'Confirmed') THEN 1 ELSE 0 END) AS active
        FROM appointments a
        WHERE TO_CHAR(a.appointment_date, 'YYYY-MM') = %s
        GROUP BY day
        ORDER BY day
        """,
        (month,),
    )
    return json_response(items)


@app.route("/api/doctor-dashboard/<int:doctor_id>", methods=["GET"])
def doctor_dashboard(doctor_id):
    doctor = fetch_one(
        """
        SELECT d.id, d.full_name, d.specialty, d.experience_years, d.consultation_fee,
               d.rating, d.availability, d.avatar_gradient, d.bio, dept.name AS department
        FROM doctors d
        LEFT JOIN departments dept ON dept.id = d.department_id
        WHERE d.id = %s
        """,
        (doctor_id,),
    )
    if not doctor:
        return json_response({"error": "Doctor not found"}, 404)

    appointments_data = fetch_all(
        """
         SELECT a.id, a.appointment_date, a.appointment_time, a.reason, a.status, a.mode, a.created_at,
             p.full_name AS patient_name, p.email, p.phone, p.age, p.gender,
               d.full_name AS doctor_name, d.specialty, dept.name AS department, d.consultation_fee
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
           JOIN doctors d ON d.id = a.doctor_id
           LEFT JOIN departments dept ON dept.id = d.department_id
        WHERE a.doctor_id = %s
        ORDER BY a.appointment_date ASC, a.appointment_time ASC
        """,
        (doctor_id,),
    )

    metrics = {
        "today": sum(1 for item in appointments_data if str(item["appointment_date"]) == str(date.today())),
        "pending": sum(1 for item in appointments_data if item["status"] == "Scheduled"),
        "confirmed": sum(1 for item in appointments_data if item["status"] == "Confirmed"),
        "completed": sum(1 for item in appointments_data if item["status"] == "Completed"),
    }
    return json_response({"doctor": doctor, "metrics": metrics, "appointments": appointments_data})


@app.route("/api/admin/summary", methods=["GET"])
@admin_required
def admin_summary():
    summary = fetch_one(
        """
        SELECT
            (SELECT COUNT(*) FROM patients) AS patients,
            (SELECT COUNT(*) FROM doctors) AS doctors,
            (SELECT COUNT(*) FROM appointments) AS appointments,
            (SELECT COUNT(*) FROM appointments WHERE status = 'Completed') AS completed,
            (SELECT COUNT(*) FROM appointments WHERE status = 'Cancelled') AS cancelled
        """
    )
    department_load = fetch_all(
        """
        SELECT dept.name, COUNT(a.id) AS total
        FROM departments dept
        LEFT JOIN doctors d ON d.department_id = dept.id
        LEFT JOIN appointments a ON a.doctor_id = d.id
        GROUP BY dept.name
        ORDER BY total DESC, dept.name ASC
        """
    )
    return json_response({"summary": summary, "departmentLoad": department_load})


@app.route("/api/notifications", methods=["GET"])
@admin_required
def notifications():
    audience = request.args.get("audience", "admin")
    if audience == "patient":
        return json_response({"error": "Use the authenticated patient notifications endpoint"}, 401)
    audience_id = request.args.get("audience_id")
    query = """
        SELECT id, audience, audience_id, title, message, is_read, created_at
        FROM notifications
        WHERE audience = %s
    """
    params = [audience]
    if audience_id:
        query += " AND (audience_id = %s OR audience_id IS NULL)"
        params.append(audience_id)
    else:
        query += " AND audience_id IS NULL"
    query += " ORDER BY created_at DESC LIMIT 10"
    return json_response(fetch_all(query, params))


@app.route("/api/notifications/<int:notification_id>/read", methods=["PATCH"])
@admin_required
def mark_notification_read(notification_id):
    row = execute_query("UPDATE notifications SET is_read = TRUE WHERE id = %s AND audience <> 'patient' RETURNING id", (notification_id,), fetch=True)
    if not row:
        return json_response({"error": "Notification not found"}, 404)
    return json_response({"message": "Notification updated"})


@app.route("/api/patient/appointments", methods=["GET"])
@patient_required
def patient_appointments():
    items = fetch_all(
        """
         SELECT a.id, a.appointment_date, a.appointment_time, a.reason, a.status, a.mode, a.created_at,
             d.full_name AS doctor_name, d.specialty, d.consultation_fee
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        WHERE a.patient_id = %s
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
        LIMIT 100
        """,
        (g.patient["id"],),
    )
    return json_response(items)


@app.route("/api/patient/notifications", methods=["GET"])
@patient_required
def patient_notifications():
    items = fetch_all(
        """
        SELECT id, title, message, is_read, created_at
        FROM notifications
        WHERE audience = 'patient' AND audience_id = %s
        ORDER BY created_at DESC
        LIMIT 50
        """,
        (g.patient["id"],),
    )
    return json_response(items)


@app.route("/api/patient/notifications/<int:notification_id>/read", methods=["PATCH"])
@patient_required
def mark_patient_notification_read(notification_id):
    row = execute_query(
        "UPDATE notifications SET is_read = TRUE WHERE id = %s AND audience = 'patient' AND audience_id = %s RETURNING id",
        (notification_id, g.patient["id"]),
        fetch=True,
    )
    if not row:
        return json_response({"error": "Notification not found"}, 404)
    return json_response({"message": "Notification marked as read"})


if __name__ == "__main__":
    initialize_database()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
