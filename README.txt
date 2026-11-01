MAKHADO COMMUNITY HEALTH CENTRE — CONNECTED CONSULTATION BUILD

WHAT IS CONNECTED
- Patient registration and login use a server-side SQLite database.
- Passwords are stored as scrypt hashes, not plain text.
- Appointment requests are saved to the database and appear in the administrator dashboard.
- Each appointment receives a unique booking reference (format MHC-XXXXXXXX).
- After submission, patients see a confirmation screen with their reference, date, service and current status.
- Patients can track status using the booking reference plus the same phone number or email used when booking.
- Admins can update appointment status to Requested, Confirmed, Completed or Cancelled; the patient sees the latest status when they track the appointment.
- Contact enquiries are saved to the database and appear in the administrator dashboard.
- Patient feedback submissions (category, 1–5 rating, optional name and comment) are saved to the database and can be reviewed and status-updated by an administrator.
- Staff accounts section lets administrators add staff directory entries with a name, role and Active/Inactive status. These are directory records only; they do not create staff login credentials.
- Activity log records appointment requests, appointment status changes, feedback submissions/status changes, and staff account creation/status changes, with timestamp, acting user, record and change details. Times display in South African local time.
- Admin sign-in is required to view requests and update appointment status.
- Data remains in makhado.db after the server is stopped and restarted.
- Clinic operating hours: 08:00–16:00. Telephone: 015 333 4245.

RUN ON WINDOWS
1. Install Node.js 22 or newer from https://nodejs.org/ if it is not already installed.
2. Extract this folder from the ZIP.
3. Double-click start.bat.
4. Keep the black terminal window open while using the website.
5. Open http://127.0.0.1:3000 in your browser.
6. Open Admin and sign in with:
   Email: admin@makhado.local
   Password: ChangeMe-Clinic-2026!
7. Register a test patient, submit an appointment request, submit feedback from the Patient feedback page, then check Admin to see and update the requests. After submitting an appointment, save the displayed booking reference. Use Book appointment → Track an appointment to check the status with the same contact detail used on the form.
8. Stop the server with Ctrl+C in the terminal. The database file is makhado.db.

CHANGE ADMIN PASSWORD BEFORE SHARING THE COMPUTER
In Command Prompt, set ADMIN_EMAIL and ADMIN_PASSWORD before running server.js/start.bat. For example:
  set ADMIN_EMAIL=your-admin-email@example.com
  set ADMIN_PASSWORD=use-a-long-unique-password-here
  node server.js
The admin account is created on the first run. If the default admin was already created, changing environment variables does not change that existing account. For a local consultation, use the supplied credentials and do not expose the computer/server to the internet.

IMPORTANT LIMITATIONS / HEALTH DATA SAFETY
This is a connected local consultation build, not a production-ready clinical system. It has no HTTPS, email delivery, automated password reset, patient identity verification, backups, deployment configuration, or independent security assessment. The activity log is a basic local audit trail and is not tamper-proof or a substitute for a production audit system. Sessions are held in server memory and expire when the server restarts. Admin login is a basic access gate. Use fictional records only during the consultation. Do not enter real patient information, diagnoses, ID numbers, medication details, or real passwords. Do not publish this server to the public internet. Before live use, the clinic/IT owner must arrange hosting with HTTPS, security review, POPIA compliance, retention controls, backups, incident response, and approved workflows.

TECHNICAL NOTES
- Requires Node.js 22.5+ because it uses the built-in node:sqlite module.
- No npm packages are required.
- Database is created automatically as makhado.db on first launch.
- Forgot password shows the recovery limitation; no reset email is sent.
- Appointment submissions are requests, not confirmed bookings.

PRINTABLE CLINIC MANAGEMENT REPORT
Sign in to the Admin dashboard and select "Print clinic report". The report summarises total appointment requests, completed appointments (counted as patients treated), confirmed, pending and cancelled requests, plus completed appointments by service. Use the browser print dialog to print or save as PDF. Only mark an appointment Completed after the patient has actually attended and received the service. The report is an administrative summary of records entered into this prototype.
