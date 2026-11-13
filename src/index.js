
const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;

  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] || 0) ^ (y[i] || 0);
  }

  return diff === 0;
}

function isAdmin(request, env) {
  const secret = env.ADMIN_SECRET;
  const supplied = request.headers.get("X-Admin-Secret") || "";

  return (
    typeof secret === "string" &&
    secret.length >= 6 &&
    safeEqual(supplied, secret)
  );
}

function clean(value, max = 150) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

async function api(request, env, path) {
  if (!env.DB) {
    return json({ error: "Database D1 tidak disambungkan" }, 500);
  }

  // Public health check
  if (path === "/api/health" && request.method === "GET") {
    try {
      const result = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM workers"
      ).first();

      return json({
        status: "ok",
        database: "connected",
        total_workers: result?.total ?? 0
      });
    } catch {
      return json({ error: "Database tidak dapat dibaca" }, 500);
    }
  }

  // Verify admin credentials

if (path === "/api/admin/verify" && request.method === "POST") {
  const configured = typeof env.ADMIN_SECRET === "string";
  const supplied = request.headers.get("X-Admin-Secret") || "";

  if (!configured || env.ADMIN_SECRET.length < 20) {
    return json({
      error: "ADMIN_SECRET tidak tersedia atau tidak sah dalam Worker",
      code: "SECRET_CONFIG_ERROR"
    }, 503);
  }

  if (!safeEqual(supplied, env.ADMIN_SECRET)) {
    return json({
      error: "Kunci yang dimasukkan tidak sepadan dengan Secret Cloudflare",
      code: "SECRET_MISMATCH"
    }, 401);
  }

  return json({ ok: true, message: "Login berjaya" });
}

  }

  // All remaining admin APIs require authentication
  if (!isAdmin(request, env)) {
    return json({ error: "Akses admin tidak dibenarkan" }, 401);
  }

  if (path === "/api/admin/workers" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id, full_name, active, created_at FROM workers ORDER BY id DESC"
    ).all();
    return json(result.results);
  }

  if (path === "/api/admin/workers" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = clean(body.full_name, 120);
    const code = clean(body.staff_code, 40).toUpperCase();

    if (!name || !/^[A-Z0-9_-]{4,40}$/.test(code)) {
      return json({ error: "Nama atau ID pekerja tidak sah" }, 400);
    }

    try {
      await env.DB.prepare(
        "INSERT INTO workers (full_name, ic_hash) VALUES (?, ?)"
      ).bind(name, "TEMP:" + code).run();

      return json({ ok: true }, 201);
    } catch {
      return json({ error: "ID pekerja sudah wujud atau gagal disimpan" }, 409);
    }
  }

  if (path === "/api/admin/events" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id, event_name, event_date, location FROM events ORDER BY event_date DESC, id DESC"
    ).all();
    return json(result.results);
  }

  if (path === "/api/admin/events" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = clean(body.event_name);
    const date = clean(body.event_date, 10);
    const location = clean(body.location);

    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: "Nama atau tarikh event tidak sah" }, 400);
    }

    await env.DB.prepare(
      "INSERT INTO events (event_name, event_date, location) VALUES (?, ?, ?)"
    ).bind(name, date, location).run();

    return json({ ok: true }, 201);
  }

  if (path === "/api/admin/assign" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const eventId = Number(body.event_id);
    const workerId = Number(body.worker_id);

    if (
      !Number.isSafeInteger(eventId) || eventId < 1 ||
      !Number.isSafeInteger(workerId) || workerId < 1
    ) {
      return json({ error: "ID event atau pekerja tidak sah" }, 400);
    }

    const event = await env.DB.prepare(
      "SELECT id FROM events WHERE id = ?"
    ).bind(eventId).first();

    const worker = await env.DB.prepare(
      "SELECT id FROM workers WHERE id = ? AND active = 1"
    ).bind(workerId).first();

    if (!event || !worker) {
      return json({ error: "Event atau pekerja tidak ditemui" }, 404);
    }

    await env.DB.prepare(
      "INSERT OR IGNORE INTO event_workers (event_id, worker_id) VALUES (?, ?)"
    ).bind(eventId, workerId).run();

    return json({ ok: true });
  }

  if (path === "/api/admin/attendance" && request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT a.id, e.event_name, e.event_date,
             w.full_name, a.check_in, a.check_out
      FROM attendance a
      JOIN workers w ON w.id = a.worker_id
      JOIN events e ON e.id = a.event_id
      ORDER BY a.id DESC
      LIMIT 200
    `).all();

    return json(result.results);
  }

  return json({ error: "API tidak ditemui" }, 404);
}

const page = `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ES Staff Attendance</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f1f5f9;color:#182b49;font-family:Arial,sans-serif}
header{background:#203e78;color:white;padding:24px 18px;text-align:center}
header h1{font-size:25px;margin:0 0 8px}
main{max-width:650px;margin:auto;padding:16px}
.card{background:white;border-radius:17px;padding:22px;margin:15px 0;box-shadow:0 5px 20px #0000000c}
h2{font-size:20px;margin-top:0}
label{display:block;font-size:14px;font-weight:bold;margin:13px 0 6px}
input,select{width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:9px;font-size:16px;background:white}
button{background:#203e78;color:white;border:0;padding:14px;border-radius:10px;font-size:16px;font-weight:bold;width:100%;margin-top:14px}
button.secondary{background:#e5eaf2;color:#203e78}
small,.muted{color:#64748b}
.item{padding:12px 0;border-bottom:1px solid #e5e7eb;overflow-wrap:anywhere}
.item:last-child{border:0}
.hidden{display:none}
.notice{padding:12px;border-radius:9px;background:#eef2ff;margin-top:12px;overflow-wrap:anywhere}
</style>
</head>
<body>
<header>
<h1>ES Staff Attendance</h1>
<div>ES Mega Event · Dashboard Admin</div>
</header>
<main>
<section id="login" class="card">
<h2>🔐 Log Masuk Admin</h2>
<p class="muted">Masukkan kunci admin yang disimpan di Cloudflare.</p>
<label>Kunci Admin</label>
<input id="secret" type="password" autocomplete="off">
<button onclick="login()">Log Masuk</button>
<div id="loginMsg" class="notice" role="status"></div>
</section>

<div id="dashboard" class="hidden">
<section class="card">
<h2>👋 Dashboard Admin</h2>
<button class="secondary" onclick="loadAll()">Muat Semula Data</button>
<button class="secondary" onclick="logout()">Log Keluar</button>
<div id="summary" class="notice"></div>
</section>

<section class="card">
<h2>👷 Daftar Pekerja</h2>
<label>Nama Penuh</label>
<input id="workerName" placeholder="Nama pekerja">
<label>ID Pekerja Sementara</label>
<input id="workerCode" placeholder="Contoh STAFF001">
<small>Jangan masukkan nombor IC sebenar.</small>
<button onclick="addWorker()">Simpan Pekerja</button>
<div id="workers"></div>
</section>

<section class="card">
<h2>📅 Cipta Event</h2>
<label>Nama Event</label>
<input id="eventName" placeholder="Contoh Wedding Kenangan Glass Hall">
<label>Tarikh Event</label>
<input id="eventDate" type="date">
<label>Lokasi</label>
<input id="eventLocation" placeholder="Lokasi event">
<button onclick="addEvent()">Simpan Event</button>
<div id="events"></div>
</section>

<section class="card">
<h2>📋 Tetapkan Pekerja Bertugas</h2>
<label>Pilih Event</label>
<select id="assignEvent"></select>
<label>Pilih Pekerja</label>
<select id="assignWorker"></select>
<button onclick="assignWorker()">Tetapkan Pekerja</button>
</section>

<section class="card">
<h2>📊 Laporan Kehadiran</h2>
<div id="attendance"></div>
</section>

<div id="message" class="notice" role="status"></div>
</div>
</main>
<script>
let adminSecret = "";

function showMessage(message) {
  document.getElementById("message").textContent = message;
}

async function callApi(path, method = "GET", data) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Secret": adminSecret
    },
    body: data ? JSON.stringify(data) : undefined,
    cache: "no-store"
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Ralat sistem");
  }

  return result;
}

async function login() {
  adminSecret = document.getElementById("secret").value;
  const msg = document.getElementById("loginMsg");

  try {
    await callApi("/api/admin/verify", "POST");
    document.getElementById("secret").value = "";
    msg.textContent = "";
    document.getElementById("login").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    await loadAll();
  } catch (error) {
    adminSecret = "";
    msg.textContent = error.message;
  }
}

function logout() {
  adminSecret = "";
  document.getElementById("dashboard").classList.add("hidden");
  document.getElementById("login").classList.remove("hidden");
}

function renderItems(id, items, format) {
  const el = document.getElementById(id);
  el.replaceChildren();

  if (!items.length) {
    el.textContent = "Tiada rekod lagi.";
    return;
  }

  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = format(item);
    el.appendChild(div);
  });
}

function fillSelect(id, items, label) {
  const select = document.getElementById(id);
  select.replaceChildren();

  items.forEach(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = label(item);
    select.appendChild(option);
  });
}

async function loadAll() {
  try {
    const [workers, events, attendance] = await Promise.all([
      callApi("/api/admin/workers"),
      callApi("/api/admin/events"),
      callApi("/api/admin/attendance")
    ]);

    document.getElementById("summary").textContent =
      workers.length + " pekerja · " +
      events.length + " event · " +
      attendance.length + " rekod kehadiran";

    renderItems("workers", workers,
      w => "#" + w.id + " · " + w.full_name +
      (w.active ? " · Aktif" : " · Tidak aktif"));

    renderItems("events", events,
      e => "#" + e.id + " · " + e.event_date +
      " · " + e.event_name + " · " + (e.location || "-"));

    renderItems("attendance", attendance,
      a => a.full_name + " · " + a.event_name +
      " · Masuk: " + (a.check_in || "-") +
      " · Keluar: " + (a.check_out || "-"));

    fillSelect("assignEvent", events,
      e => e.event_date + " · " + e.event_name);

    fillSelect("assignWorker", workers.filter(w => w.active),
      w => w.full_name);
  } catch (error) {
    showMessage(error.message);
  }
}

async function addWorker() {
  try {
    await callApi("/api/admin/workers", "POST", {
      full_name: document.getElementById("workerName").value,
      staff_code: document.getElementById("workerCode").value
    });

    document.getElementById("workerName").value = "";
    document.getElementById("workerCode").value = "";
    showMessage("✅ Pekerja berjaya didaftarkan");
    await loadAll();
  } catch (error) {
    showMessage("❌ " + error.message);
  }
}

async function addEvent() {
  try {
    await callApi("/api/admin/events", "POST", {
      event_name: document.getElementById("eventName").value,
      event_date: document.getElementById("eventDate").value,
      location: document.getElementById("eventLocation").value
    });

    showMessage("✅ Event berjaya dicipta");
    await loadAll();
  } catch (error) {
    showMessage("❌ " + error.message);
  }
}

async function assignWorker() {
  try {
    await callApi("/api/admin/assign", "POST", {
      event_id: Number(document.getElementById("assignEvent").value),
      worker_id: Number(document.getElementById("assignWorker").value)
    });

    showMessage("✅ Pekerja berjaya ditetapkan untuk event");
  } catch (error) {
    showMessage("❌ " + error.message);
  }
}
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await api(request, env, url.pathname);
      }

      if (url.pathname === "/" && request.method === "GET") {
        return new Response(page, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer"
          }
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("ES Staff error:", error);
      return json({ error: "Ralat dalaman server" }, 500);
    }
  }
};
