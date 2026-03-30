export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return await handleUpload(request, env);
    }

    if (url.pathname === "/api/messages") {
      return await listMessages(request, env);
    }

    if (url.pathname === "/api/gallery") {
      return await listGallery(request, env);
    }

    if (url.pathname === "/api/export") {
      return await exportCSV(request, env);
    }

    if (url.pathname.startsWith("/media/")) {
      return await serveMedia(request, env, url.pathname.replace("/media/", ""));
    }

    return new Response("Not found", { status: 404 });
  }
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;

async function handleUpload(request, env) {
  const formData = await request.formData();

  const files = formData.getAll("media").filter(f => f instanceof File);
  const guestName = sanitize(formData.get("guestName"));
  const contact = sanitize(formData.get("contact"));
  const message = sanitize(formData.get("message"), 1500);

  if (!files.length && !guestName && !contact && !message) {
    return json({ error: "Please upload or leave a message." }, 400, request);
  }

  const uploadId = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();

  const savedFiles = [];

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return json({ error: `${file.name} exceeds 100MB` }, 400, request);
    }

    const ext = getExt(file.name);
    const type = file.type || "application/octet-stream";
    const category = type.startsWith("video/") ? "videos" : "photos";

    const key = `wedding-uploads/${datePath()}/${uploadId}/${category}/${slug(file.name)}-${crypto.randomUUID()}.${ext}`;

    await env.WEDDING_UPLOADS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: type }
    });

    savedFiles.push({
      key,
      originalName: file.name,
      type,
      category
    });
  }

  const submission = {
    uploadId,
    uploadedAt,
    guestName,
    contact,
    message,
    files: savedFiles
  };

  await env.WEDDING_UPLOADS.put(
    `wedding-uploads/${datePath()}/${uploadId}/submission.json`,
    JSON.stringify(submission),
    { httpMetadata: { contentType: "application/json" } }
  );

  return json({ ok: true }, 200, request);
}

async function listMessages(request, env) {
  const submissions = await getAllSubmissions(env);

  const messages = submissions.map(s => ({
    guestName: s.guestName,
    uploadedAt: s.uploadedAt,
    message: redact(s.message, s.contact),
    filesCount: s.files?.length || 0,
    hasPhotos: s.files?.some(f => f.category === "photos"),
    hasVideos: s.files?.some(f => f.category === "videos")
  }));

  return json({ messages }, 200, request);
}

async function listGallery(request, env) {
  const submissions = await getAllSubmissions(env);

  const photos = [];

  for (const s of submissions) {
    for (const f of (s.files || [])) {
      if (f.category === "photos") {
        photos.push({
          url: `${new URL(request.url).origin}/media/${encodeURIComponent(f.key)}`,
          uploadedAt: s.uploadedAt,
          guestName: s.guestName,
          originalName: f.originalName
        });
      }
    }
  }

  return json({ photos }, 200, request);
}

async function serveMedia(request, env, key) {
  const obj = await env.WEDDING_UPLOADS.get(decodeURIComponent(key));
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=3600");

  return new Response(obj.body, { headers });
}

async function exportCSV(request, env) {
  const submissions = await getAllSubmissions(env);

  const rows = [["Upload ID","Date","Name","Contact","Message","Files"]];

  for (const s of submissions) {
    rows.push([
      s.uploadId,
      s.uploadedAt,
      s.guestName,
      s.contact,
      s.message,
      s.files?.length || 0
    ]);
  }

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=messages.csv"
    }
  });
}

async function getAllSubmissions(env) {
  let cursor;
  const keys = [];

  do {
    const res = await env.WEDDING_UPLOADS.list({ prefix: "wedding-uploads/", cursor });
    res.objects.forEach(o => {
      if (o.key.endsWith("submission.json")) keys.push(o.key);
    });
    cursor = res.truncated ? res.cursor : null;
  } while (cursor);

  const results = [];

  for (const key of keys) {
    const obj = await env.WEDDING_UPLOADS.get(key);
    if (obj) {
      results.push(JSON.parse(await obj.text()));
    }
  }

  return results;
}

function redact(text = "", contact = "") {
  let t = text || "";

  t = t.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]");
  t = t.replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted phone]");

  if (contact) {
    const safe = contact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(safe, "gi"), "[redacted contact]");
  }

  return t;
}

function sanitize(v, max=500) {
  return String(v || "").trim().slice(0, max);
}

function slug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

function getExt(name) {
  return name.split(".").pop().toLowerCase();
}

function datePath() {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
}

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
}

function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(request)
    }
  });
}
