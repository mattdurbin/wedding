export default {
  async fetch(request, env) {
    const url = new URL(request.url);


    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return await handleUpload(request, env);
    }
    
    if (url.pathname === "/api/admin/debug-turnstile" && request.method === "GET") {
  return json({
    hasTurnstileSecret: !!env.TURNSTILE_SECRET
  }, 200, request);
}

    if (url.pathname === "/api/messages" && request.method === "GET") {
      return await listMessages(request, env);
    }

    if (url.pathname === "/api/gallery" && request.method === "GET") {
      return await listGallery(request, env);
    }

    if (url.pathname === "/api/videos" && request.method === "GET") {
      return await listVideos(request, env);
    }

    if (url.pathname === "/api/export" && request.method === "GET") {
      return await exportCSV(request, env);
    }

    if (url.pathname === "/api/admin/check" && request.method === "GET") {
      return await adminCheck(request, env);
    }

    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      return await adminLogin(request, env);
    }

    if (url.pathname === "/api/admin/logout" && request.method === "POST") {
      return await adminLogout(request, env);
    }

    if (url.pathname === "/api/admin/list" && request.method === "GET") {
      return await adminList(request, env);
    }

    if (url.pathname === "/api/admin/delete-submission" && request.method === "POST") {
      return await adminDeleteSubmission(request, env);
    }

    if (url.pathname === "/api/admin/delete-media" && request.method === "POST") {
      return await adminDeleteMedia(request, env);
    }

    if (url.pathname === "/api/admin/bulk-delete" && request.method === "POST") {
      return await adminBulkDelete(request, env);
    }

    if (url.pathname === "/api/admin/download-photos" && request.method === "GET") {
      return await adminDownloadMediaByType(request, env, "photos");
    }

    if (url.pathname === "/api/admin/download-videos" && request.method === "GET") {
      return await adminDownloadMediaByType(request, env, "videos");
    }

    if (url.pathname.startsWith("/api/media/") && request.method === "GET") {
      return await serveMedia(request, env, url.pathname.substring("/api/media/".length));
    }

    return new Response("Not found", { status: 404 });
  }
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;

/* =========================
   TURNSTILE + UPLOAD
========================= */

async function handleUpload(request, env) {
  const formData = await request.formData();

  const turnstileToken = String(formData.get("turnstileToken") || "").trim();
  const remoteIp = request.headers.get("CF-Connecting-IP") || "";

  if (!turnstileToken) {
    return json({ error: "Please complete the human check." }, 400, request);
  }

  const turnstileResult = await verifyTurnstileToken(
    turnstileToken,
    remoteIp,
    env.TURNSTILE_SECRET
  );

  if (!turnstileResult.success) {
    const codes = turnstileResult["error-codes"] || [];
    return json({
      error: `Human check failed: ${codes.join(", ") || "unknown-error"}`,
      codes
    }, 400, request);
  }

  const uploads = formData.getAll("media").filter(f => f instanceof File);
  const thumbs = formData.getAll("thumb").filter(f => f instanceof File);

  const uploadId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const guestName = sanitizeText(formData.get("guestName"));
  const contact = sanitizeText(formData.get("contact"));
  const message = sanitizeText(formData.get("message"), 1500);

  const saved = [];
  let thumbIndex = 0;

  for (const file of uploads) {
    if (file.size > MAX_FILE_SIZE) {
      return json({ error: "File too large" }, 400, request);
    }

    const isVideo = file.type.startsWith("video/");
    const category = isVideo ? "videos" : "photos";

    const key = `uploads/${uploadId}/${category}/${crypto.randomUUID()}-${file.name}`;

    await env.WEDDING_UPLOADS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type }
    });

    let thumbKey = null;

    if (!isVideo && thumbs[thumbIndex]) {
      const thumbFile = thumbs[thumbIndex];

      thumbKey = `uploads/${uploadId}/thumbs/${crypto.randomUUID()}-${thumbFile.name}`;

      await env.WEDDING_UPLOADS.put(thumbKey, await thumbFile.arrayBuffer(), {
        httpMetadata: { contentType: thumbFile.type }
      });

      thumbIndex++;
    }

    saved.push({
      key,
      thumbKey,
      originalName: file.name,
      type: file.type,
      category
    });
  }

  await env.WEDDING_UPLOADS.put(
    `uploads/${uploadId}/submission.json`,
    JSON.stringify({
      uploadId,
      uploadedAt: timestamp,
      guestName,
      contact,
      message,
      files: saved
    })
  );

  return json({ ok: true, message: "Upload successful 💛" }, 200, request);
}

/* =========================
   GALLERY
========================= */

async function listGallery(request, env) {
  const submissions = await readAll(env);

  const photos = [];

  for (const s of submissions) {
    for (const file of s.files || []) {
      if (file.category === "photos") {
        photos.push({
          ...file,
          uploadedAt: s.uploadedAt,
          guestName: s.guestName,
          url: `/api/media/${encodeURIComponent(file.key)}`,
          thumbUrl: file.thumbKey
            ? `/api/media/${encodeURIComponent(file.thumbKey)}`
            : `/api/media/${encodeURIComponent(file.key)}`
        });
      }
    }
  }

  return json({ photos }, 200, request);
}

async function listVideos(request, env) {
  const submissions = await readAll(env);

  const videos = [];

  for (const s of submissions) {
    for (const file of s.files || []) {
      if (file.category === "videos") {
        videos.push({
          ...file,
          uploadedAt: s.uploadedAt,
          guestName: s.guestName,
          url: `/api/media/${encodeURIComponent(file.key)}`
        });
      }
    }
  }

  return json({ videos }, 200, request);
}

/* =========================
   MEDIA SERVE
========================= */

async function serveMedia(request, env, key) {
  const obj = await env.WEDDING_UPLOADS.get(decodeURIComponent(key));
  if (!obj) return new Response("Not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

/* =========================
   ADMIN (MINIMAL KEEP)
========================= */

async function adminCheck(request, env) {
  return json({ ok: true }, 200, request);
}

async function adminLogin(request, env) {
  const { password } = await request.json();
  if (password !== env.ADMIN_PASSWORD) {
    return json({ error: "Wrong password" }, 401, request);
  }
  return json({ ok: true }, 200, request);
}

async function adminLogout() {
  return json({ ok: true });
}

async function adminList(request, env) {
  const submissions = await readAll(env);
  return json({ submissions }, 200, request);
}

async function adminDeleteSubmission(request, env) {
  return json({ ok: true });
}

async function adminDeleteMedia(request, env) {
  return json({ ok: true });
}

async function adminBulkDelete(request, env) {
  return json({ ok: true });
}

/* =========================
   ZIP DOWNLOAD
========================= */

async function adminDownloadMediaByType(request, env, wantedCategory) {
  if (!(await isAdminAuthenticated(request, env))) {
    return json({ error: "Unauthorised" }, 401, request);
  }

  const submissions = await readAllSubmissionRecords(env);
  const zipEntries = [];

  for (const submission of submissions) {
    const uploadId = submission.data.uploadId || "unknown";
    const guestName = sanitizeFolderName(submission.data.guestName || "guest");
    const folder = `${uploadId}_${guestName}`;

    const files = Array.isArray(submission.data.files) ? submission.data.files : [];
    const matchingFiles = files.filter(file => String(file.category || "") === wantedCategory);

    if (!matchingFiles.length) continue;

    const summaryText =
`Upload ID: ${submission.data.uploadId || ""}
Uploaded At: ${submission.data.uploadedAt || ""}
Guest Name: ${submission.data.guestName || ""}
Contact: ${submission.data.contact || ""}
Message:
${submission.data.message || ""}
`;

    zipEntries.push({
      name: `${folder}/submission.txt`,
      data: new TextEncoder().encode(summaryText)
    });

    for (const file of matchingFiles) {
      if (!file.key) continue;

      const object = await env.WEDDING_UPLOADS.get(file.key);
      if (!object) continue;

      const safeName = sanitizeFileName(file.originalName || file.key.split("/").pop() || "file");
      const bytes = new Uint8Array(await object.arrayBuffer());

      zipEntries.push({
        name: `${folder}/${wantedCategory}/${safeName}`,
        data: bytes
      });
    }
  }

  if (!zipEntries.length) {
    return json({ error: `No ${wantedCategory} found` }, 400, request);
  }

  const zipBytes = await createZip(zipEntries);
  const datePart = new Date().toISOString().slice(0, 10);
  const filename = `wedding-${wantedCategory}-${datePart}.zip`;

  return new Response(zipBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}

/* =========================
   TURNSTILE VERIFY
========================= */

async function verifyTurnstileToken(token, ip, secret) {
  if (!secret) {
    return { success: false, "error-codes": ["missing-input-secret"] };
  }

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: ip
      })
    }
  );

  return await res.json();
}

/* =========================
   HELPERS
========================= */

async function readAll(env) {
  const list = await env.WEDDING_UPLOADS.list({ prefix: "uploads/" });

  const results = [];

  for (const obj of list.objects) {
    if (!obj.key.endsWith("submission.json")) continue;

    const file = await env.WEDDING_UPLOADS.get(obj.key);
    const data = JSON.parse(await file.text());

    results.push(data);
  }

  return results;
}

function sanitizeText(v, max = 500) {
  return String(v || "").slice(0, max);
}

function json(data, status = 200, request = new Request("https://x")) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request)
    }
  });
}

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}