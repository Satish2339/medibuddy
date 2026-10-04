# Medibuddy Hospital Appointment Booking Mini Project

Separate frontend and backend project for a hospital appointment booking system using only HTML, CSS, JavaScript, Python, Flask, and PostgreSQL.

## Included Modules

- Multi-colour responsive hospital landing page
- Doctor listing page
- Patient appointment booking page
- Doctor dashboard for reviewing assigned appointments
- Admin panel for hospital management
- PostgreSQL schema for doctors, patients, appointments, and notifications
- Patient registration and sign-in with hashed passwords and expiring JWT sessions
- Private patient dashboard for appointments and appointment-status notifications
- Calendar view for appointment load
- Browser push-style notifications
- Mobile-friendly frontend with manifest and service worker

## Project Structure

```text
backend/
frontend/
README.md
```

## Backend Setup

1. Create PostgreSQL database:

```sql
CREATE DATABASE hospital_booking;
```

2. Copy `backend/.env.example` to `backend/.env`.

3. Update the PostgreSQL username, password, host, and database name.

4. Install dependencies:

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Backend runs at `http://127.0.0.1:5000`.

Set a long, random `JWT_SECRET` in `backend/.env` before deployment. If omitted, a random key is generated for the current process, so existing sessions will expire when the backend restarts. Set `CORS_ORIGINS` to the exact frontend origin(s) you deploy. Never commit `.env` or expose the signing key.

Set `ADMIN_USERNAME` and a unique, strong `ADMIN_PASSWORD` in `backend/.env` before opening `frontend/admin.html`; the example file contains placeholders only. Admin sessions expire after eight hours, are stored in the current browser tab, and admin booking/summary/notification/status APIs require the signed administrator token. Failed sign-ins are rate-limited per server process. Restart Flask after changing credentials.

Configure a verified sender in `SMTP_FROM` and a `BREVO_API_KEY` to deliver email OTPs over HTTPS; keep the API key in environment settings, never in frontend files or source control. SMTP remains available by setting `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD`; use an app password where supported. Render Free blocks SMTP ports 25, 465, and 587, so use the Brevo API there. Set `SMTP_USE_SSL=true` only for implicit-SSL SMTP (commonly port 465); otherwise STARTTLS is used.

## Patient Accounts and Notifications

- Open `frontend/auth.html` to sign in or reset a password, and `frontend/register.html` to create a patient account. Registration and sign-in require a six-digit email OTP that expires after 10 minutes; codes are hashed in the database, limited to five attempts, and resend is throttled for 60 seconds. Passwords are stored as password hashes, and successful verification returns a 12-hour bearer token.
- The patient portal at `frontend/patient-dashboard.html` shows only the signed-in patient's appointments and notifications. It refreshes notices while open; browser alerts are optional and require permission.
- Appointment booking requires a signed-in patient. Notifications are created when a patient books and when an appointment status changes.
- The patient portal keeps up to 100 appointments as a visit history with upcoming/past filters. Patient, doctor, and admin appointment lists can open a print-ready visit summary; choose “Save as PDF” in the browser print dialog to save it.
- The admin operations center at `frontend/admin.html` summarizes booking status, today's visits, review workload, and department distribution. Its appointment register supports patient/doctor/reason search, status and date filters, CSV export, status changes, and appointment-summary PDFs.
- API flow: `POST /api/auth/admin/login` returns an administrator token after configured credentials pass; that token is required for admin booking, summary, notification, and status-update routes. `POST /api/auth/register` sends a code; `POST /api/auth/register/verify-otp` verifies it and creates the account. `POST /api/auth/login` checks the password and sends a code; `POST /api/auth/login/verify-otp` verifies it and returns a patient session. Also available: `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/patient/appointments`, `GET /api/patient/notifications`, and `PATCH /api/patient/notifications/{id}/read`.
- Patient API routes require `Authorization: Bearer <token>`. Legacy patient records without a verified account cannot be claimed through registration; contact the application administrator to verify those records.

## Frontend Setup

Run a local server from the `frontend` folder:

```bash
cd frontend
python -m http.server 5500
```

Open `http://127.0.0.1:5500`.

If backend URL changes, edit `frontend/assets/js/config.js`.

## Deploy a Demo on Render

This repository includes a Render Blueprint in `render.yaml`. Push the project to GitHub, create a new Blueprint in Render from that repository, and enter a strong, unique admin password plus `BREVO_API_KEY` when prompted. Verify your sender email in Brevo and set it in `SMTP_FROM`. Render creates the web service and PostgreSQL database; the Flask service serves both the frontend and `/api` from one URL. Use the generated `onrender.com` URL to open the site.

This setup is for a demo with test data only. The doctor dashboard API does not yet require clinician authentication, and the project is not hardened for real patient information. Do not enter real patient data or use this deployment for clinical operations. Review the selected Render plans and database retention before deploying.

## Notes

- Tables are auto-created on backend startup.
- Sample doctors, departments, appointments, and notifications are inserted automatically on first run.
- Browser notifications require permission.

## Security and Clinical-Use Notice

The admin dashboard APIs require the configured administrator credentials. The separate doctor dashboard APIs still need clinician authentication and authorization, and this project does not yet provide a full audit trail or deployment hardening. Do not expose it to the public internet or use it for real patient data until every clinical API is access-controlled and applicable privacy/regulatory reviews are completed. A password-protected admin page does not by itself establish NMC or other regulatory compliance.

Hospital Appointment Booking Application with Beautiful UI
