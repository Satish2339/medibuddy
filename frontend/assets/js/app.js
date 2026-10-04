const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const state = { doctors: [] };
const DEMO_STORAGE_KEY = "medibuddy-demo-appointments";
const AUTH_TOKEN_KEY = "medibuddy-auth-token";
const AUTH_PATIENT_KEY = "medibuddy-auth-patient";
const ADMIN_TOKEN_KEY = "medibuddy-admin-token";
const FALLBACK_MODE_NOTE = "Demo mode active: backend unavailable, showing local sample data.";

function getSessionPatient() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_PATIENT_KEY) || "null");
  } catch {
    return null;
  }
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

function saveSession(session) {
  localStorage.setItem(AUTH_TOKEN_KEY, session.token);
  localStorage.setItem(AUTH_PATIENT_KEY, JSON.stringify(session.patient));
}

function clearSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_PATIENT_KEY);
}

const DEMO_DATA = {
  overview: {
    stats: { doctors: 4, departments: 4, appointments: 6, upcoming: 4 },
    departments: [
      { id: 1, name: "Cardiology", description: "Heart care, ECG tracking, and preventive consultation.", accent_color: "#ff6b6b" },
      { id: 2, name: "Neurology", description: "Brain, spine, and migraine assessment with digital case history.", accent_color: "#6c63ff" },
      { id: 3, name: "Pediatrics", description: "Child wellness, vaccines, and family-friendly follow up.", accent_color: "#00b894" },
      { id: 4, name: "Orthopedics", description: "Bone, joint, rehab, and sports injury appointments.", accent_color: "#f39c12" },
    ],
    featuredDoctors: [],
  },
  doctors: [
    { id: 1, full_name: "Dr. Aanya Kapoor", specialty: "Cardiologist", experience_years: 11, consultation_fee: 900, rating: 4.9, availability: "Mon-Fri | 09:00-15:00", avatar_gradient: "sunrise-wave", bio: "Focuses on preventive heart health and rapid diagnostics.", department: "Cardiology", accent_color: "#ff6b6b" },
    { id: 2, full_name: "Dr. Rohan Mehta", specialty: "Neurologist", experience_years: 9, consultation_fee: 1100, rating: 4.8, availability: "Tue-Sat | 10:00-17:00", avatar_gradient: "aurora-grid", bio: "Specializes in migraine, sleep disorder, and stroke follow-ups.", department: "Neurology", accent_color: "#6c63ff" },
    { id: 3, full_name: "Dr. Meera Iyer", specialty: "Pediatrician", experience_years: 13, consultation_fee: 800, rating: 4.9, availability: "Mon-Sat | 08:00-14:00", avatar_gradient: "mint-bloom", bio: "Known for calm consultations and vaccination planning.", department: "Pediatrics", accent_color: "#00b894" },
    { id: 4, full_name: "Dr. Karan Sethi", specialty: "Orthopedic Surgeon", experience_years: 15, consultation_fee: 1200, rating: 4.7, availability: "Mon-Fri | 11:00-18:00", avatar_gradient: "amber-flow", bio: "Handles fracture recovery, knee pain, and physiotherapy plans.", department: "Orthopedics", accent_color: "#f39c12" },
  ],
  appointments: [
    { id: 1, appointment_date: "2026-04-14", appointment_time: "10:30:00", reason: "Routine check-up", status: "Scheduled", mode: "In-person", created_at: "2026-04-13T09:00:00", patient_name: "Aarav Sharma", email: "aarav@example.com", phone: "9876543210", age: 29, gender: "Male", doctor_name: "Dr. Aanya Kapoor", specialty: "Cardiologist", doctor_id: 1 },
    { id: 2, appointment_date: "2026-04-15", appointment_time: "14:15:00", reason: "Follow-up consultation", status: "Confirmed", mode: "Video", created_at: "2026-04-13T10:15:00", patient_name: "Siya Nair", email: "siya@example.com", phone: "9123456789", age: 34, gender: "Female", doctor_name: "Dr. Rohan Mehta", specialty: "Neurologist", doctor_id: 2 },
  ],
  notifications: [
    { id: 1, audience: "admin", audience_id: null, title: "Morning brief ready", message: "2 new appointments were placed for review.", is_read: false, created_at: "2026-04-13T08:00:00" },
    { id: 2, audience: "doctor", audience_id: 1, title: "Upcoming consultation", message: "Aarav Sharma is booked for tomorrow at 10:30 AM.", is_read: false, created_at: "2026-04-13T08:20:00" },
  ],
};
DEMO_DATA.featuredDoctors = DEMO_DATA.doctors;

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function getDemoAppointments() {
  const saved = localStorage.getItem(DEMO_STORAGE_KEY);
  if (!saved) return clone(DEMO_DATA.appointments);
  try {
    return JSON.parse(saved);
  } catch {
    return clone(DEMO_DATA.appointments);
  }
}

function saveDemoAppointments(items) {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(items));
}

function setDemoMode(message = FALLBACK_MODE_NOTE) {
  state.demoMode = true;
  if (document.querySelector(".global-error")) return;
  const fallback = document.createElement("div");
  fallback.className = "global-error";
  fallback.textContent = message;
  document.body.prepend(fallback);
}

function getCalendarFromAppointments(month) {
  const lookup = {};
  getDemoAppointments().forEach((item) => {
    if (!item.appointment_date.startsWith(month)) return;
    lookup[item.appointment_date] ||= { day: item.appointment_date, total: 0, active: 0 };
    lookup[item.appointment_date].total += 1;
    if (["Scheduled", "Confirmed"].includes(item.status)) lookup[item.appointment_date].active += 1;
  });
  return Object.values(lookup).sort((a, b) => a.day.localeCompare(b.day));
}

function getDemoSummary() {
  const appointments = getDemoAppointments();
  return {
    summary: {
      patients: new Set(appointments.map((item) => item.email)).size,
      doctors: DEMO_DATA.doctors.length,
      appointments: appointments.length,
      completed: appointments.filter((item) => item.status === "Completed").length,
      cancelled: appointments.filter((item) => item.status === "Cancelled").length,
    },
    departmentLoad: DEMO_DATA.doctors.map((doctor) => ({
      name: doctor.department,
      total: appointments.filter((item) => item.doctor_id === doctor.id).length,
    })),
  };
}

function demoApi(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const url = new URL(`http://demo${path}`);
  const body = options.body ? JSON.parse(options.body) : null;
  const appointments = getDemoAppointments();

  if (method === "GET" && url.pathname === "/overview") {
    return {
      ...clone(DEMO_DATA.overview),
      stats: {
        ...DEMO_DATA.overview.stats,
        appointments: appointments.length,
        upcoming: appointments.filter((item) => ["Scheduled", "Confirmed"].includes(item.status)).length,
      },
    };
  }

  if (method === "GET" && url.pathname === "/doctors") {
    const specialty = url.searchParams.get("specialty");
    return specialty ? DEMO_DATA.doctors.filter((item) => item.specialty === specialty) : clone(DEMO_DATA.doctors);
  }

  if (method === "GET" && url.pathname === "/appointments") {
    const doctorId = url.searchParams.get("doctor_id");
    return doctorId ? appointments.filter((item) => String(item.doctor_id) === doctorId) : appointments;
  }

  if (method === "POST" && url.pathname === "/appointments") {
    const doctor = DEMO_DATA.doctors.find((item) => item.id === Number(body.doctorId));
    const newAppointment = {
      id: Date.now(),
      appointment_date: body.appointmentDate,
      appointment_time: `${body.appointmentTime}:00`,
      reason: body.reason,
      status: "Scheduled",
      mode: body.mode,
      created_at: new Date().toISOString(),
      patient_name: body.fullName,
      email: body.email,
      phone: body.phone,
      age: Number(body.age),
      gender: body.gender,
      doctor_name: doctor.full_name,
      specialty: doctor.specialty,
      doctor_id: doctor.id,
    };
    appointments.unshift(newAppointment);
    saveDemoAppointments(appointments);
    return { message: "Appointment booked successfully", appointmentId: newAppointment.id };
  }

  if (method === "PATCH" && /^\/appointments\/\d+\/status$/.test(url.pathname)) {
    const appointmentId = Number(url.pathname.split("/")[2]);
    const target = appointments.find((item) => item.id === appointmentId);
    if (!target) throw new Error("Appointment not found");
    target.status = body.status;
    saveDemoAppointments(appointments);
    return { message: "Appointment status updated" };
  }

  if (method === "GET" && url.pathname === "/calendar") {
    return getCalendarFromAppointments(url.searchParams.get("month"));
  }

  if (method === "GET" && /^\/doctor-dashboard\/\d+$/.test(url.pathname)) {
    const doctorId = Number(url.pathname.split("/")[2]);
    const doctor = DEMO_DATA.doctors.find((item) => item.id === doctorId);
    const doctorAppointments = appointments.filter((item) => item.doctor_id === doctorId);
    return {
      doctor,
      metrics: {
        today: doctorAppointments.filter((item) => item.appointment_date === new Date().toISOString().slice(0, 10)).length,
        pending: doctorAppointments.filter((item) => item.status === "Scheduled").length,
        confirmed: doctorAppointments.filter((item) => item.status === "Confirmed").length,
        completed: doctorAppointments.filter((item) => item.status === "Completed").length,
      },
      appointments: doctorAppointments,
    };
  }

  if (method === "GET" && url.pathname === "/admin/summary") {
    return getDemoSummary();
  }

  if (method === "GET" && url.pathname === "/notifications") {
    const audience = url.searchParams.get("audience") || "admin";
    const audienceId = url.searchParams.get("audience_id");
    return DEMO_DATA.notifications.filter((item) => item.audience === audience && (audienceId ? (String(item.audience_id) === audienceId || item.audience_id === null) : item.audience_id === null));
  }

  throw new Error("Demo endpoint not implemented");
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const method = (options.method || "GET").toUpperCase();
  const adminRequest = path.startsWith("/admin/")
    || path.startsWith("/notifications")
    || path.startsWith("/appointments/")
    || (path === "/appointments" && method !== "POST");
  const token = adminRequest ? getAdminToken() || getAuthToken() : getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch (error) {
    if (path.startsWith("/auth/") || path.startsWith("/patient/") || (path === "/appointments" && options.method === "POST")) {
      throw new Error(`Cannot reach the authentication API at ${API_BASE_URL}. Start the Flask backend and verify PostgreSQL is running.`);
    }
    setDemoMode();
    return demoApi(path, options);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  return response.json();
}

function createDoctorCard(doctor, compact = false) {
  const initials = doctor.full_name.split(" ").slice(0, 2).map((part) => part[0]).join("");
  return `
    <article class="doctor-card ${compact ? "compact" : ""}">
      <div class="doctor-avatar ${doctor.avatar_gradient}"><span>${initials}</span></div>
      <div class="doctor-body">
        <p class="eyebrow">${doctor.department || doctor.specialty}</p>
        <h3>${doctor.full_name}</h3>
        <p>${doctor.specialty} • ${doctor.experience_years} years experience</p>
        <div class="doctor-meta"><span>Fee Rs.${Number(doctor.consultation_fee).toFixed(0)}</span><span>Rating ${doctor.rating}</span></div>
        <p class="muted">${doctor.bio}</p>
        <div class="tag-row"><span class="tag">${doctor.availability}</span><a class="text-link" href="./book.html">Book now</a></div>
      </div>
    </article>
  `;
}

function renderMetricCards(target, metrics) {
  if (!target) return;
  target.innerHTML = metrics.map((metric) => `
    <article class="metric-card glass-card">
      <p>${metric.label}</p>
      <h3>${metric.value}</h3>
      <span>${metric.note}</span>
    </article>
  `).join("");
}

function renderNotifications(target, notifications) {
  if (!target) return;
  target.innerHTML = notifications.length ? notifications.map((notification) => `
    <article class="simple-card ${notification.is_read ? "" : "unread"}">
      <strong>${escapeHtml(notification.title)}</strong>
      <p>${escapeHtml(notification.message)}</p>
      ${notification.is_read ? "" : `<button class="table-action" type="button" data-notification-id="${escapeHtml(notification.id)}">Mark as read</button>`}
    </article>
  `).join("") : `<div class="simple-card"><strong>No updates</strong><p>Notifications will appear here.</p></div>`;
}

async function loadDoctors() {
  state.doctors = await apiFetch("/doctors");
  return state.doctors;
}

function populateDoctorOptions(target, doctors, includePrompt = true) {
  if (!target) return;
  const prompt = includePrompt ? '<option value="">Choose doctor</option>' : "";
  target.innerHTML = prompt + doctors.map((doctor) => `<option value="${doctor.id}">${doctor.full_name} • ${doctor.specialty}</option>`).join("");
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function appointmentPdfMarkup(appointment, patient = {}) {
  const appointmentId = escapeHtml(appointment.id);
  const patientName = escapeHtml(appointment.patient_name || patient.full_name || "Patient");
  const email = escapeHtml(appointment.email || patient.email || "Not provided");
  const phone = escapeHtml(appointment.phone || patient.phone || "Not provided");
  const doctorName = escapeHtml(appointment.doctor_name || "Care team");
  const specialty = escapeHtml(appointment.specialty || "Consultation");
  const date = escapeHtml(formatDate(appointment.appointment_date));
  const time = escapeHtml(String(appointment.appointment_time || "").slice(0, 5));
  const status = escapeHtml(appointment.status || "Scheduled");
  const mode = escapeHtml(appointment.mode || "In-person");
  const reason = escapeHtml(appointment.reason || "Consultation");
  const fee = appointment.consultation_fee == null
    ? "To be confirmed by the clinic"
    : `₹${escapeHtml(Number(appointment.consultation_fee).toLocaleString("en-IN"))}`;
  const bookedAt = appointment.created_at ? escapeHtml(new Date(appointment.created_at).toLocaleString("en-IN")) : "—";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Appointment-${appointmentId}-Medibuddy</title><style>
    *{box-sizing:border-box}body{margin:0;padding:42px;color:#18333b;background:#fff;font:14px/1.55 Arial,sans-serif}.sheet{max-width:760px;margin:0 auto;border:1px solid #dce8e5;border-radius:18px;overflow:hidden}.top{padding:30px 34px;background:#0b5554;color:#fff}.brand{font-size:13px;font-weight:700;letter-spacing:.08em}.top h1{margin:25px 0 4px;font-size:27px}.top p{margin:0;color:#d1ebe5}.content{padding:28px 34px}.status{display:inline-block;margin-bottom:22px;padding:6px 12px;border-radius:99px;background:#e8f5ef;color:#08775f;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}.field{padding:13px 0;border-bottom:1px solid #e8efed}.label{display:block;color:#71858a;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em}.value{display:block;margin-top:4px;color:#19343b;font-weight:700;overflow-wrap:anywhere}.reason{margin-top:22px;padding:17px;border-radius:12px;background:#f3f8f6}.reason p{margin:6px 0 0;white-space:pre-wrap}.footer{margin-top:26px;padding-top:16px;border-top:1px solid #e8efed;color:#75878b;font-size:11px}.print{position:fixed;right:24px;top:20px;padding:10px 16px;border:0;border-radius:8px;background:#087f78;color:#fff;font-weight:700;cursor:pointer}@media print{body{padding:0}.sheet{max-width:none;border:0;border-radius:0}.print{display:none}}@media(max-width:560px){body{padding:14px}.top,.content{padding:22px}.grid{grid-template-columns:1fr}}
    </style></head><body><button class="print" onclick="window.print()">Save / print PDF</button><article class="sheet"><header class="top"><div class="brand">✚ &nbsp; MEDIBUDDY <span style="font-weight:400;letter-spacing:0">· PATIENT CARE</span></div><h1>Appointment summary</h1><p>Booking reference MB-${appointmentId}</p></header><main class="content"><span class="status">${status}</span><div class="grid"><div class="field"><span class="label">Patient</span><span class="value">${patientName}</span></div><div class="field"><span class="label">Doctor</span><span class="value">${doctorName}</span></div><div class="field"><span class="label">Specialty</span><span class="value">${specialty}</span></div><div class="field"><span class="label">Date and time</span><span class="value">${date} · ${time}</span></div><div class="field"><span class="label">Visit mode</span><span class="value">${mode}</span></div><div class="field"><span class="label">Consultation fee</span><span class="value">${fee}</span></div><div class="field"><span class="label">Email</span><span class="value">${email}</span></div><div class="field"><span class="label">Phone</span><span class="value">${phone}</span></div></div><section class="reason"><span class="label">Reason for visit</span><p>${reason}</p></section><p class="footer">Booked ${bookedAt}. Please contact the clinic if you need to change this appointment. This summary is not a medical record or proof of payment.</p></main></article><script>window.addEventListener("load",()=>setTimeout(()=>window.print(),350));</script></body></html>`;
}

function downloadAppointmentPdf(appointment, patient = {}) {
  let printWindow = window.open("", "_blank", "width=860,height=720");
  if (!printWindow) {
    const printFrame = document.createElement("iframe");
    printFrame.className = "appointment-print-frame";
    printFrame.title = `Appointment ${appointment.id} print view`;
    document.body.append(printFrame);
    printWindow = printFrame.contentWindow;
    printWindow.addEventListener("afterprint", () => printFrame.remove(), { once: true });
  }
  printWindow.document.open();
  printWindow.document.write(appointmentPdfMarkup(appointment, patient));
  printWindow.document.close();
  return true;
}

async function initHomePage() {
  const overview = await apiFetch("/overview");
  renderMetricCards(document.getElementById("heroStats"), [
    { label: "Doctors", value: overview.stats.doctors, note: "Specialists on platform" },
    { label: "Departments", value: overview.stats.departments, note: "Hospital care zones" },
    { label: "Appointments", value: overview.stats.appointments, note: "Tracked in database" },
    { label: "Upcoming", value: overview.stats.upcoming, note: "Scheduled and confirmed" },
  ]);
  document.getElementById("departmentGrid").innerHTML = overview.departments.map((department) => `
    <article class="department-card" style="--accent:${department.accent_color}">
      <h3>${department.name}</h3>
      <p>${department.description}</p>
    </article>
  `).join("");
  document.getElementById("featuredDoctors").innerHTML = overview.featuredDoctors.map((doctor) => createDoctorCard(doctor, true)).join("");
  document.getElementById("notificationPreview").innerHTML = '<article class="simple-card"><strong>Private patient updates</strong><p>Sign in to your patient account to view appointment updates connected to you.</p></article>';
}

async function initDoctorsPage() {
  const doctors = await loadDoctors();
  const filter = document.getElementById("specialtyFilter");
  const specialties = [...new Set(doctors.map((doctor) => doctor.specialty))];
  filter.innerHTML = ['<option value="">All specialties</option>', ...specialties.map((item) => `<option value="${item}">${item}</option>`)].join("");
  const render = (list) => {
    document.getElementById("doctorDirectory").innerHTML = list.map((doctor) => createDoctorCard(doctor)).join("");
  };
  render(doctors);
  filter.addEventListener("change", async () => {
    const path = filter.value ? `/doctors?specialty=${encodeURIComponent(filter.value)}` : "/doctors";
    render(await apiFetch(path));
  });
}

async function renderCalendar(monthValue) {
  const month = monthValue || new Date().toISOString().slice(0, 7);
  const data = await apiFetch(`/calendar?month=${month}`);
  const lookup = Object.fromEntries(data.map((item) => [item.day, item]));
  const [year, monthIndex] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  document.getElementById("calendarGrid").innerHTML = Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const key = `${month}-${day}`;
    const item = lookup[key];
    return `<article class="calendar-day ${item ? "active" : ""}"><strong>${index + 1}</strong><span>${item ? `${item.total} bookings` : "Open slots"}</span></article>`;
  }).join("");
}

async function maybeNotify(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

async function initBookingPage() {
  const doctors = await loadDoctors();
  populateDoctorOptions(document.getElementById("doctorSelect"), doctors);
  const patient = getSessionPatient();
  const authNotice = document.getElementById("bookingAuthNotice");
  if (patient) {
    const profileFields = { fullName: "full_name", email: "email", phone: "phone", age: "age", gender: "gender" };
    Object.entries(profileFields).forEach(([field, patientField]) => {
      const input = document.querySelector(`[name="${field}"]`);
      if (input) {
        input.value = patient[patientField] || "";
        if (input.tagName === "SELECT") input.disabled = true;
        else input.readOnly = true;
      }
    });
    if (authNotice) authNotice.textContent = `Signed in as ${patient.full_name}. Booking details are linked to your account.`;
  } else if (authNotice) {
    authNotice.innerHTML = 'Sign in or create a patient account before booking. <a class="text-link" href="./auth.html">Go to sign in</a>.';
  }

  const monthInput = document.getElementById("calendarMonth");
  monthInput.value = new Date().toISOString().slice(0, 7);
  await renderCalendar(monthInput.value);
  monthInput.addEventListener("change", () => renderCalendar(monthInput.value));

  const recentAppointments = getAuthToken() ? await apiFetch("/patient/appointments") : [];
  document.getElementById("recentAppointments").innerHTML = recentAppointments.slice(0, 5).map((item) => `
    <article class="simple-card booking-recent-item">
      <strong>${escapeHtml(item.doctor_name)}</strong>
      <p>${escapeHtml(item.specialty)} • ${formatDate(item.appointment_date)} • ${escapeHtml(String(item.appointment_time).slice(0, 5))}</p>
      <button class="table-action appointment-pdf-button" type="button" data-appointment-id="${escapeHtml(item.id)}">Download PDF</button>
    </article>
  `).join("") || '<article class="simple-card"><strong>Your appointments</strong><p>Sign in and book to see your private appointment history here.</p></article>';
  document.querySelectorAll("#recentAppointments .appointment-pdf-button").forEach((button) => {
    button.addEventListener("click", () => {
      const appointment = recentAppointments.find((item) => String(item.id) === button.dataset.appointmentId);
      if (appointment && !downloadAppointmentPdf(appointment, patient || {})) {
        document.getElementById("bookingMessage").textContent = "Allow pop-ups to open the appointment PDF.";
      }
    });
  });

  document.getElementById("appointmentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!getAuthToken()) {
      document.getElementById("bookingMessage").textContent = "Please sign in before booking your appointment.";
      document.getElementById("bookingMessage").className = "inline-message error";
      return;
    }
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const message = document.getElementById("bookingMessage");
    try {
      const result = await apiFetch("/appointments", { method: "POST", body: JSON.stringify(payload) });
      message.textContent = `${result.message}. Appointment ID: ${result.appointmentId}`;
      message.className = "inline-message success";
      form.reset();
      await renderCalendar(monthInput.value);
      if (getAuthToken()) {
        const refreshedAppointments = await apiFetch("/patient/appointments");
        document.getElementById("recentAppointments").innerHTML = refreshedAppointments.slice(0, 5).map((item) => `
          <article class="simple-card booking-recent-item"><strong>${escapeHtml(item.doctor_name)}</strong>
            <p>${escapeHtml(item.specialty)} • ${formatDate(item.appointment_date)} • ${escapeHtml(String(item.appointment_time).slice(0, 5))}</p>
            <button class="table-action appointment-pdf-button" type="button" data-appointment-id="${escapeHtml(item.id)}">Download PDF</button>
          </article>
        `).join("");
        document.querySelectorAll("#recentAppointments .appointment-pdf-button").forEach((button) => {
          button.addEventListener("click", () => {
            const appointment = refreshedAppointments.find((item) => String(item.id) === button.dataset.appointmentId);
            if (appointment && !downloadAppointmentPdf(appointment, patient || {})) {
              message.textContent = "Allow pop-ups to open the appointment PDF.";
            }
          });
        });
      }
      await maybeNotify("Appointment Confirmed", `Your hospital booking ID is ${result.appointmentId}.`);
    } catch (error) {
      message.textContent = error.message;
      message.className = "inline-message error";
    }
  });
}

function setupAuthNavigation() {
  const nav = document.querySelector(".nav-links");
  if (!nav) return;
  if (!nav.querySelector('[data-auth-link="true"]')) {
    const patientLink = document.createElement("a");
    patientLink.dataset.authLink = "true";
    const patient = getSessionPatient();
    if (patient && getAuthToken()) {
      patientLink.href = "./patient-dashboard.html";
      patientLink.textContent = "My Care";
      patientLink.classList.toggle("active", document.body.dataset.page === "patient-dashboard");
      nav.append(patientLink);
      const logout = document.createElement("a");
      logout.href = "#logout";
      logout.textContent = "Sign out";
      logout.dataset.logoutLink = "true";
      nav.append(logout);
      logout.addEventListener("click", async (event) => {
        event.preventDefault();
        try { await apiFetch("/auth/logout", { method: "POST", body: "{}" }); } catch { /* Clear the local session even if the API is offline. */ }
        clearSession();
        window.location.href = "./index.html";
      });
    } else {
      patientLink.href = "./auth.html";
      patientLink.textContent = "Sign in";
      patientLink.classList.toggle("active", document.body.dataset.page === "auth");
      nav.append(patientLink);
    }
  }
}

async function requestAuthOtp(form, endpoint, otpForm, setMessage) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  setMessage("");
  try {
    const response = await apiFetch(endpoint, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    const email = response.email || form.elements.email.value.trim().toLowerCase();
    otpForm.elements.email.value = email;
    otpForm.querySelector("[data-otp-email]").textContent = email;
    form.hidden = true;
    otpForm.hidden = false;
    otpForm.elements.otp.focus();
    setMessage(response.message, "success");
  } catch (error) {
    setMessage(error.message);
  } finally {
    button.disabled = false;
  }
}

async function completeAuthentication(form, endpoint, setMessage) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  setMessage("");
  try {
    const session = await apiFetch(endpoint, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    saveSession(session);
    window.location.href = "./patient-dashboard.html";
  } catch (error) {
    setMessage(error.message);
  } finally {
    button.disabled = false;
  }
}

async function initAuthPage() {
  const loginForm = document.getElementById("loginForm");
  const forgotPasswordForm = document.getElementById("forgotPasswordForm");
  const resetPasswordForm = document.getElementById("resetPasswordForm");
  const loginOtpForm = document.getElementById("loginOtpForm");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const message = document.getElementById("authMessage");
  const setMessage = (text, kind = "error") => {
    message.textContent = text;
    message.className = `inline-message auth-message ${text ? kind : ""}`;
  };
  const showLogin = () => {
    loginForm.hidden = false;
    forgotPasswordForm.hidden = true;
    resetPasswordForm.hidden = true;
    loginOtpForm.hidden = true;
    forgotPasswordLink.hidden = false;
    setMessage("");
  };
  forgotPasswordLink.addEventListener("click", () => {
    loginForm.hidden = true;
    forgotPasswordForm.hidden = false;
    setMessage("");
    forgotPasswordForm.elements.email.value = loginForm.elements.email.value;
    forgotPasswordForm.elements.email.focus();
  });
  loginForm.addEventListener("submit", (event) => { event.preventDefault(); requestAuthOtp(loginForm, "/auth/login", loginOtpForm, setMessage); });
  forgotPasswordForm.addEventListener("submit", (event) => { event.preventDefault(); requestAuthOtp(forgotPasswordForm, "/auth/forgot-password", resetPasswordForm, setMessage); });
  resetPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = resetPasswordForm.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(resetPasswordForm).entries());
    if (values.password !== values.confirmPassword) {
      setMessage("The passwords do not match.");
      return;
    }
    delete values.confirmPassword;
    button.disabled = true;
    setMessage("");
    try {
      const result = await apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify(values) });
      resetPasswordForm.hidden = true;
      loginForm.hidden = false;
      loginForm.elements.email.value = values.email;
      loginForm.elements.password.value = "";
      resetPasswordForm.reset();
      forgotPasswordLink.hidden = false;
      setMessage(result.message, "success");
      loginForm.elements.password.focus();
    } catch (error) {
      setMessage(error.message);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("backToLoginFromForgot").addEventListener("click", showLogin);
  loginOtpForm.addEventListener("submit", (event) => { event.preventDefault(); completeAuthentication(loginOtpForm, "/auth/login/verify-otp", setMessage); });
  document.getElementById("resendLoginOtp").addEventListener("click", () => requestAuthOtp(loginForm, "/auth/login", loginOtpForm, setMessage));
  document.getElementById("backToLogin").addEventListener("click", showLogin);
  document.getElementById("backToForgotPassword").addEventListener("click", () => {
    resetPasswordForm.hidden = true;
    forgotPasswordForm.hidden = false;
    setMessage("");
    forgotPasswordForm.elements.email.value = resetPasswordForm.elements.email.value;
    forgotPasswordForm.elements.email.focus();
  });
  if (getAuthToken()) {
    try {
      const result = await apiFetch("/auth/me");
      saveSession({ token: getAuthToken(), patient: result.patient });
      window.location.href = "./patient-dashboard.html";
    } catch {
      clearSession();
    }
  }
}

function initRegisterPage() {
  const registerForm = document.getElementById("registerForm");
  const registerOtpForm = document.getElementById("registerOtpForm");
  const message = document.getElementById("registerMessage");
  const setMessage = (text, kind = "error") => {
    message.textContent = text;
    message.className = `inline-message auth-message ${text ? kind : ""}`;
  };
  const showRegistration = () => {
    registerForm.hidden = false;
    registerOtpForm.hidden = true;
    setMessage("");
  };
  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    requestAuthOtp(registerForm, "/auth/register", registerOtpForm, setMessage);
  });
  registerOtpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    completeAuthentication(registerOtpForm, "/auth/register/verify-otp", setMessage);
  });
  document.getElementById("resendRegisterOtp").addEventListener("click", () => {
    requestAuthOtp(registerForm, "/auth/register", registerOtpForm, setMessage);
  });
  document.getElementById("backToRegister").addEventListener("click", showRegistration);
}

async function initPatientDashboard() {
  if (!getAuthToken()) {
    window.location.href = "./auth.html";
    return;
  }
  let patient;
  try {
    const result = await apiFetch("/auth/me");
    patient = result.patient;
    saveSession({ token: getAuthToken(), patient });
  } catch {
    clearSession();
    window.location.href = "./auth.html";
    return;
  }
  document.getElementById("patientWelcome").textContent = `Welcome, ${patient.full_name}`;
  document.getElementById("patientDetails").textContent = `${patient.email} • ${patient.phone}`;
  const appointmentFilter = document.getElementById("patientAppointmentFilter");
  const renderAppointmentHistory = (appointments) => {
    state.patientAppointments = appointments;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = appointments.filter((item) => item.appointment_date >= today && ["Scheduled", "Confirmed"].includes(item.status));
    const past = appointments.filter((item) => !upcoming.includes(item));
    document.getElementById("patientAppointmentSummary").innerHTML = [
      { label: "Total visits", value: appointments.length, note: "Your appointment history" },
      { label: "Upcoming", value: upcoming.length, note: "Scheduled or confirmed" },
      { label: "Past visits", value: past.length, note: "Completed or previous" },
    ].map((item) => `<article class="patient-stat"><span>${escapeHtml(item.label)}</span><strong>${item.value}</strong><small>${escapeHtml(item.note)}</small></article>`).join("");

    let visible = appointments;
    if (appointmentFilter.value === "upcoming") visible = upcoming;
    if (appointmentFilter.value === "past") visible = past;
    const target = document.getElementById("patientAppointments");
    target.innerHTML = visible.length ? visible.map((item) => `
      <article class="appointment-history-item">
        <div class="appointment-history-date"><strong>${escapeHtml(new Date(`${item.appointment_date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit" }))}</strong><span>${escapeHtml(new Date(`${item.appointment_date}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" }))}</span></div>
        <div class="appointment-history-content"><div class="appointment-history-heading"><div><p class="eyebrow">${escapeHtml(item.specialty || "Consultation")}</p><h3>${escapeHtml(item.doctor_name)}</h3></div><span class="status-pill">${escapeHtml(item.status)}</span></div>
          <p class="appointment-history-meta">${escapeHtml(String(item.appointment_time).slice(0, 5))} · ${escapeHtml(item.mode)} · Ref MB-${escapeHtml(item.id)}</p>
          <p class="appointment-history-reason">${escapeHtml(item.reason)}</p>
          <button class="table-action appointment-pdf-button" type="button" data-appointment-id="${escapeHtml(item.id)}">Download appointment PDF</button>
        </div>
      </article>
    `).join("") : `<article class="simple-card appointment-empty"><strong>${appointments.length ? "No visits in this view" : "No appointment history yet"}</strong><p>${appointments.length ? "Choose a different history filter to see your visits." : "Book an appointment and it will appear here with a downloadable visit summary."}</p>${appointments.length ? "" : '<a class="text-link" href="./book.html">Book your first appointment →</a>'}</article>`;
    target.querySelectorAll(".appointment-pdf-button").forEach((button) => {
      button.addEventListener("click", () => {
        const appointment = visible.find((item) => String(item.id) === button.dataset.appointmentId);
        if (appointment && !downloadAppointmentPdf(appointment, patient)) {
          document.getElementById("patientDashboardMessage").textContent = "Allow pop-ups to open the appointment PDF for printing or saving.";
        }
      });
    });
  };
  const renderPatientData = async (notifyNew = false) => {
    const [appointments, notifications] = await Promise.all([
      apiFetch("/patient/appointments"),
      apiFetch("/patient/notifications"),
    ]);
    renderAppointmentHistory(appointments);
    const previousIds = new Set(state.patientNotificationIds || []);
    renderNotifications(document.getElementById("patientNotifications"), notifications);
    state.patientNotificationIds = notifications.map((item) => item.id);
    if (notifyNew && "Notification" in window && Notification.permission === "granted") {
      notifications.filter((item) => !previousIds.has(item.id)).forEach((item) => new Notification(item.title, { body: item.message }));
    }
    document.querySelectorAll("[data-notification-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        await apiFetch(`/patient/notifications/${button.dataset.notificationId}/read`, { method: "PATCH" });
        await renderPatientData();
      });
    });
  };
  appointmentFilter.addEventListener("change", () => renderAppointmentHistory(state.patientAppointments || []));
  await renderPatientData();
  document.getElementById("patientBrowserAlerts").addEventListener("click", async () => {
    if (!("Notification" in window)) {
      document.getElementById("patientDashboardMessage").textContent = "Browser notifications are not supported in this browser.";
      return;
    }
    const permission = await Notification.requestPermission();
    document.getElementById("patientDashboardMessage").textContent = permission === "granted" ? "Browser alerts are enabled on this device." : "Browser alerts were not enabled.";
  });
  window.setInterval(() => renderPatientData(true).catch(() => {}), 30000);
}

async function renderDoctorDashboard(doctorId) {
  const dashboard = await apiFetch(`/doctor-dashboard/${doctorId}`);
  renderMetricCards(document.getElementById("doctorMetrics"), [
    { label: "Today", value: dashboard.metrics.today, note: "Consultations today" },
    { label: "Pending", value: dashboard.metrics.pending, note: "Need review" },
    { label: "Confirmed", value: dashboard.metrics.confirmed, note: "Ready for visit" },
    { label: "Completed", value: dashboard.metrics.completed, note: "Closed cases" },
  ]);
  document.getElementById("doctorAppointmentsTable").innerHTML = dashboard.appointments.length ? dashboard.appointments.map((item) => `
    <tr>
      <td>${escapeHtml(item.patient_name)}<span class="table-subtext">${escapeHtml(item.gender)}, ${escapeHtml(item.age)} yrs</span></td>
      <td>${formatDate(item.appointment_date)}</td>
      <td>${escapeHtml(String(item.appointment_time).slice(0, 5))}</td>
      <td>${escapeHtml(item.reason)}</td>
      <td>${escapeHtml(item.mode)}</td>
      <td><span class="status-pill">${escapeHtml(item.status)}</span></td>
      <td><button class="table-action appointment-pdf-button" type="button" data-appointment-id="${escapeHtml(item.id)}">PDF</button></td>
    </tr>
  `).join("") : '<tr><td class="table-empty" colspan="7">No appointments are assigned to this doctor yet.</td></tr>';
  document.querySelectorAll("#doctorAppointmentsTable .appointment-pdf-button").forEach((button) => {
    button.addEventListener("click", () => {
      const appointment = dashboard.appointments.find((item) => String(item.id) === button.dataset.appointmentId);
      if (appointment && !downloadAppointmentPdf(appointment)) window.alert("Allow pop-ups to open the appointment PDF.");
    });
  });
}

async function initDoctorDashboardPage() {
  const doctors = await loadDoctors();
  const select = document.getElementById("doctorDashboardSelect");
  populateDoctorOptions(select, doctors, false);
  if (doctors.length) {
    select.value = doctors[0].id;
    await renderDoctorDashboard(doctors[0].id);
  }
  select.addEventListener("change", () => renderDoctorDashboard(select.value));
}

async function initAdminPage() {
  const loginGate = document.getElementById("adminLoginGate");
  const dashboard = document.getElementById("adminDashboard");
  const loginForm = document.getElementById("adminLoginForm");
  const loginMessage = document.getElementById("adminLoginMessage");
  const loginButton = document.getElementById("adminLoginButton");
  dashboard.hidden = true;
  loginGate.hidden = false;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginButton.disabled = true;
    loginMessage.textContent = "";
    loginMessage.className = "inline-message";
    const credentials = Object.fromEntries(new FormData(loginForm).entries());
    try {
      const session = await apiFetch("/auth/admin/login", { method: "POST", body: JSON.stringify(credentials) });
      sessionStorage.setItem(ADMIN_TOKEN_KEY, session.token);
      loginForm.elements.password.value = "";
      await loadDashboard();
    } catch (error) {
      loginMessage.textContent = error.message;
      loginMessage.className = "inline-message error";
    } finally {
      loginButton.disabled = false;
    }
  });

  document.getElementById("adminLogout").addEventListener("click", () => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    dashboard.hidden = true;
    loginGate.hidden = false;
    loginForm.reset();
    loginForm.elements.username.value = "admin";
    loginMessage.textContent = "You have been signed out.";
    loginMessage.className = "inline-message success";
    loginForm.elements.password.focus();
  });

  let appointments = [];
  let notifications = [];
  let summaryResponse = { summary: {}, departmentLoad: [] };
  const table = document.getElementById("adminAppointmentsTable");
  const search = document.getElementById("adminAppointmentSearch");
  const statusFilter = document.getElementById("adminAppointmentStatus");
  const fromDate = document.getElementById("adminAppointmentFrom");
  const toDate = document.getElementById("adminAppointmentTo");
  const message = document.getElementById("adminMessage");
  const today = new Date();
  const todayIso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  const getVisibleAppointments = () => {
    const searchTerm = search.value.trim().toLowerCase();
    return appointments.filter((item) => {
      const matchesSearch = [item.patient_name, item.doctor_name, item.specialty, item.reason, item.email, item.phone, item.id]
        .some((value) => String(value || "").toLowerCase().includes(searchTerm));
      const matchesStatus = statusFilter.value === "all" || item.status === statusFilter.value;
      const matchesFrom = !fromDate.value || item.appointment_date >= fromDate.value;
      const matchesTo = !toDate.value || item.appointment_date <= toDate.value;
      return matchesSearch && matchesStatus && matchesFrom && matchesTo;
    });
  };

  const renderAppointments = () => {
    const visible = getVisibleAppointments();
    document.getElementById("adminAppointmentCount").textContent = `Showing ${visible.length} of ${appointments.length} appointments`;
    table.innerHTML = visible.length ? visible.map((item) => `
      <tr>
        <td>${escapeHtml(item.patient_name)}<span class="table-subtext">${escapeHtml(item.email)}</span></td>
        <td>${escapeHtml(item.doctor_name)}<span class="table-subtext">${escapeHtml(item.specialty)}</span></td>
        <td>${formatDate(item.appointment_date)}<span class="table-subtext">${escapeHtml(String(item.appointment_time).slice(0, 5))} · ${escapeHtml(item.mode)}</span></td>
        <td>${escapeHtml(item.reason)}</td>
        <td><span class="status-pill">${escapeHtml(item.status)}</span></td>
        <td><div class="admin-status-control"><select aria-label="New status for appointment ${escapeHtml(item.id)}" data-admin-status="${escapeHtml(item.id)}" data-current-status="${escapeHtml(item.status)}"><option ${item.status === "Scheduled" ? "selected" : ""}>Scheduled</option><option ${item.status === "Confirmed" ? "selected" : ""}>Confirmed</option><option ${item.status === "Completed" ? "selected" : ""}>Completed</option><option ${item.status === "Cancelled" ? "selected" : ""}>Cancelled</option></select><button class="table-action" type="button" data-admin-save-id="${escapeHtml(item.id)}" disabled>Save</button></div></td>
        <td><button class="table-action appointment-pdf-button" type="button" data-admin-pdf-id="${escapeHtml(item.id)}">PDF</button></td>
      </tr>
    `).join("") : `<tr><td class="table-empty" colspan="7">${appointments.length ? "No bookings match these filters." : "No appointments have been booked yet."}</td></tr>`;
  };

  const renderOverview = () => {
    const countByStatus = (status) => appointments.filter((item) => item.status === status).length;
    const scheduled = countByStatus("Scheduled");
    const confirmed = countByStatus("Confirmed");
    const completed = countByStatus("Completed");
    const cancelled = countByStatus("Cancelled");
    const todayCount = appointments.filter((item) => item.appointment_date === todayIso && ["Scheduled", "Confirmed"].includes(item.status)).length;
    const activeCount = scheduled + confirmed;
    renderMetricCards(document.getElementById("adminMetrics"), [
      { label: "Total appointments", value: appointments.length, note: `${summaryResponse.summary.patients || 0} patients on record` },
      { label: "Needs review", value: scheduled, note: "Scheduled · pending confirmation" },
      { label: "Visits today", value: todayCount, note: "Scheduled or confirmed" },
      { label: "Confirmed", value: confirmed, note: `${completed} completed · ${cancelled} cancelled` },
    ]);
    const totalsByDepartment = new Map();
    appointments.forEach((item) => {
      const label = item.department || item.specialty || "Unassigned";
      totalsByDepartment.set(label, (totalsByDepartment.get(label) || 0) + 1);
    });
    const departments = summaryResponse.departmentLoad.map((item) => ({ name: item.name, total: totalsByDepartment.get(item.name) || 0 }));
    const maxTotal = Math.max(1, ...departments.map((item) => item.total));
    document.getElementById("departmentLoad").innerHTML = departments.map((item) => `
      <article class="admin-department-row"><div class="admin-department-label"><strong>${escapeHtml(item.name)}</strong><span>${item.total} ${item.total === 1 ? "visit" : "visits"}</span></div><div class="admin-load-track"><span style="width:${Math.round(item.total / maxTotal * 100)}%"></span></div></article>
    `).join("") || '<p class="muted">No department data available.</p>';
    document.getElementById("adminActiveCount").textContent = `${activeCount} active`;
  };

  const renderAdminNotifications = () => {
    renderNotifications(document.getElementById("adminNotifications"), notifications);
    document.querySelectorAll("#adminNotifications [data-notification-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await apiFetch(`/notifications/${button.dataset.notificationId}/read`, { method: "PATCH", body: "{}" });
          notifications = await apiFetch("/notifications?audience=admin");
          renderAdminNotifications();
        } catch (error) {
          message.textContent = error.message;
          message.className = "inline-message error";
          button.disabled = false;
        }
      });
    });
  };

  const loadDashboard = async () => {
    const refreshButton = document.getElementById("adminRefresh");
    refreshButton.disabled = true;
    try {
      [summaryResponse, appointments, notifications] = await Promise.all([
        apiFetch("/admin/summary"),
        apiFetch("/appointments"),
        apiFetch("/notifications?audience=admin"),
      ]);
      renderOverview();
      renderAppointments();
      renderAdminNotifications();
      document.getElementById("adminLastUpdated").textContent = `Updated ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
      message.textContent = "";
      message.className = "inline-message";
      loginGate.hidden = true;
      dashboard.hidden = false;
    } catch (error) {
      if (/administrator sign-in|administrator session/i.test(error.message)) {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        dashboard.hidden = true;
        loginGate.hidden = false;
        loginMessage.textContent = error.message;
        loginMessage.className = "inline-message error";
      } else {
        message.textContent = `Dashboard could not refresh: ${error.message}`;
        message.className = "inline-message error";
      }
    } finally {
      refreshButton.disabled = false;
    }
  };

  [search, statusFilter, fromDate, toDate].forEach((control) => {
    control.addEventListener(control === search ? "input" : "change", renderAppointments);
  });
  document.getElementById("adminClearFilters").addEventListener("click", () => {
    search.value = "";
    statusFilter.value = "all";
    fromDate.value = "";
    toDate.value = "";
    renderAppointments();
  });
  document.getElementById("adminRefresh").addEventListener("click", loadDashboard);
  document.getElementById("adminExport").addEventListener("click", () => {
    const visible = getVisibleAppointments();
    const columns = ["Appointment ID", "Patient", "Email", "Phone", "Doctor", "Specialty", "Date", "Time", "Mode", "Reason", "Status"];
    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = visible.map((item) => [item.id, item.patient_name, item.email, item.phone, item.doctor_name, item.specialty, item.appointment_date, item.appointment_time, item.mode, item.reason, item.status]);
    const blob = new Blob(["\uFEFF", [columns, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `medibuddy-appointments-${todayIso}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  table.addEventListener("click", async (event) => {
    const saveButton = event.target.closest("[data-admin-save-id]");
    const pdfButton = event.target.closest("[data-admin-pdf-id]");
    if (pdfButton) {
      const appointment = appointments.find((item) => String(item.id) === pdfButton.dataset.adminPdfId);
      if (appointment && !downloadAppointmentPdf(appointment)) window.alert("Allow pop-ups to open the appointment PDF.");
      return;
    }
    if (!saveButton) return;
    const appointmentId = saveButton.dataset.adminSaveId;
    const select = table.querySelector(`[data-admin-status="${appointmentId}"]`);
    const nextStatus = select.value;
    saveButton.disabled = true;
    try {
      await apiFetch(`/appointments/${appointmentId}/status`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
      await loadDashboard();
      message.textContent = `Appointment MB-${appointmentId} updated to ${nextStatus}.`;
      message.className = "inline-message success";
    } catch (error) {
      message.textContent = error.message;
      message.className = "inline-message error";
      saveButton.disabled = false;
    }
  });
  table.addEventListener("change", (event) => {
    const select = event.target.closest("[data-admin-status]");
    if (!select) return;
    const saveButton = table.querySelector(`[data-admin-save-id="${select.dataset.adminStatus}"]`);
    saveButton.disabled = select.value === select.dataset.currentStatus;
  });
  if (getAdminToken()) await loadDashboard();
}

function setupNotifications() {
  const button = document.getElementById("enableNotificationsBtn");
  if (!button) return;
  button.addEventListener("click", async () => {
    if (!("Notification" in window)) {
      alert("Browser notifications are not supported.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await maybeNotify("Notifications Enabled", "You will receive booking reminders in this browser.");
    }
  });
}

function setupMobileNav() {
  const toggle = document.getElementById("mobileNavToggle");
  const nav = document.querySelector(".nav-links");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => nav.classList.toggle("open"));
}

async function initPage() {
  setupMobileNav();
  setupAuthNavigation();
  setupNotifications();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => null);
  }
  switch (document.body.dataset.page) {
    case "home":
      await initHomePage();
      break;
    case "doctors":
      await initDoctorsPage();
      break;
    case "book":
      await initBookingPage();
      break;
    case "auth":
      await initAuthPage();
      break;
    case "register":
      initRegisterPage();
      break;
    case "patient-dashboard":
      await initPatientDashboard();
      break;
    case "doctor-dashboard":
      await initDoctorDashboardPage();
      break;
    case "admin":
      await initAdminPage();
      break;
    default:
      break;
  }
}

initPage().catch((error) => {
  setDemoMode(`Unable to load live data: ${error.message}. Showing demo data instead.`);
});
