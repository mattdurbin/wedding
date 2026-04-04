export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return await handleUpload(request, env);
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

    if (url.pathname === "/api/admin/delete-message" && request.method === "POST") {
      return await adminDeleteMessage(request, env);
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
const ALLOWED_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif",
  "mp4", "mov", "m4v", "avi", "wmv", "webm", "mkv", "mpeg", "mpg", "3gp", "mts", "m2ts", "ogv"
];

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
    env.TURNSTILE_SECRET_KEY
  );

  if (!turnstileResult.success) {
    const codes = turnstileResult["error-codes"] || [];
    return json({
      error: `Human check failed: ${codes.join(", ") || "unknown-error"}`,
      codes
    }, 400, request);
  }

  const uploads = formData.getAll("media").filter(item => item instanceof File && item.name);
  const thumbs = formData.getAll("thumb").filter(item => item instanceof File && item.name);

  const guestName = sanitizeText(formData.get("guestName"));
  const contact = sanitizeText(formData.get("contact"));
  const message = sanitizeText(formData.get("message"), 1500);

  if (!uploads.length && !guestName && !contact && !message) {
    return json({ error: "Please upload at least one file or leave a message." }, 400, request);
  }

  const uploadId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const saved = [];
  let thumbIndex = 0;

  for (const file of uploads) {
    if (file.size > MAX_FILE_SIZE) {
      return json({ error: `File too large: ${file.name}. Maximum size is 100MB.` }, 400, request);
    }

    const extension = getExtension(file.name);
    const mimeType = file.type || mimeFromExtension(extension);
    const allowedByMime = mimeType.startsWith("image/") || mimeType.startsWith("video/");
    const allowedByExtension = ALLOWED_EXTENSIONS.includes(extension);

    if (!allowedByMime && !allowedByExtension) {
      return json({ error: `Unsupported file type: ${file.name}` }, 400, request);
    }

    const safeBaseName = slugify(stripExtension(file.name)) || "file";
    const category = mimeType.startsWith("video/") ? "videos" : "photos";
    const key = `wedding-uploads/${datePath()}/${uploadId}/${category}/${safeBaseName}-${crypto.randomUUID()}.${extension || "bin"}`;

    await env.WEDDING_UPLOADS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        originalName: file.name,
        guestName,
        contact,
        message,
        uploadedAt: timestamp,
        uploadId,
        category
      }
    });

    let thumbKey = null;

    if (category === "photos" && thumbs[thumbIndex]) {
      const thumbFile = thumbs[thumbIndex];
      const thumbExt = getExtension(thumbFile.name) || "jpg";
      const thumbMime = thumbFile.type || "image/jpeg";

      thumbKey = `wedding-uploads/${datePath()}/${uploadId}/thumbs/${safeBaseName}-${crypto.randomUUID()}.${thumbExt}`;

      await env.WEDDING_UPLOADS.put(thumbKey, await thumbFile.arrayBuffer(), {
        httpMetadata: { contentType: thumbMime },
        customMetadata: {
          originalName: thumbFile.name,
          guestName,
          contact,
          message,
          uploadedAt: timestamp,
          uploadId,
          category: "thumbs"
        }
      });

      thumbIndex += 1;
    }

    saved.push({
      key,
      thumbKey,
      originalName: file.name,
      size: file.size,
      type: mimeType,
      category
    });
  }

  const metadataKey = `wedding-uploads/${datePath()}/${uploadId}/submission.json`;
  const metadata = {
    uploadId,
    uploadedAt: timestamp,
    guestName,
    contact,
    message,
    files: saved,
    hasFiles: saved.length > 0,
    userAgent: request.headers.get("user-agent") || ""
  };

  await env.WEDDING_UPLOADS.put(metadataKey, JSON.stringify(metadata, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });

  const messageOnly = saved.length === 0;
  return json({
    ok: true,
    message: messageOnly
      ? "Thank you — your message has been saved successfully."
      : `Thank you — your message and ${saved.length} file${saved.length === 1 ? "" : "s"} have been saved successfully.`
  }, 200, request);
}

async function listMessages(request, env) {
  const submissions = await readAllSubmissionRecords(env);

  const messages = submissions
    .filter(item =>
      item.data.message ||
      item.data.guestName ||
      item.data.contact ||
      (item.data.files && item.data.files.length)
    )
    .sort((a, b) => String(b.data.uploadedAt || "").localeCompare(String(a.data.uploadedAt || "")))
    .map(item => ({
      uploadId: item.data.uploadId || "",
      uploadedAt: item.data.uploadedAt || "",
      guestName: item.data.guestName || "",
      message: redactSensitiveText(item.data.message || "", item.data.contact || ""),
      filesCount: Array.isArray(item.data.files) ? item.data.files.length : 0,
      hasPhotos: Array.isArray(item.data.files)
        ? item.data.files.some(f => String(f.category || "").startsWith("photo"))
        : false,
      hasVideos: Array.isArray(item.data.files)
        ? item.data.files.some(f => String(f.category || "").startsWith("video"))
        : false
    }));

  return json({ messages }, 200, request);
}

async function listGallery(request, env) {
  const submissions = await readAllSubmissionRecords(env);
  const photos = [];
  const origin = new URL(request.url).origin;

  for (const item of submissions) {
    const files = Array.isArray(item.data.files) ? item.data.files : [];

    for (const file of files) {
      const type = String(file.type || "");
      const category = String(file.category || "");

      if (type.startsWith("image/") || category === "photos") {
        photos.push({
          uploadId: item.data.uploadId || "",
          uploadedAt: item.data.uploadedAt || "",
          guestName: item.data.guestName || "",
          originalName: file.originalName || "",
          key: file.key,
          url: `${origin}/api/media/${encodeURIComponent(file.key)}`,
          thumbUrl: file.thumbKey
            ? `${origin}/api/media/${encodeURIComponent(file.thumbKey)}`
            : `${origin}/api/media/${encodeURIComponent(file.key)}`
        });
      }
    }
  }

  photos.sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));
  return json({ photos }, 200, request);
}

async function listVideos(request, env) {
  const submissions = await readAllSubmissionRecords(env);
  const videos = [];
  const origin = new URL(request.url).origin;

  for (const item of submissions) {
    const files = Array.isArray(item.data.files) ? item.data.files : [];

    for (const file of files) {
      const type = String(file.type || "");
      const category = String(file.category || "");

      if (type.startsWith("video/") || category === "videos") {
        videos.push({
          uploadId: item.data.uploadId || "",
          uploadedAt: item.data.uploadedAt || "",
          guestName: item.data.guestName || "",
          originalName: file.originalName || "",
          key: file.key,
          url: `${origin}/api/media/${encodeURIComponent(file.key)}`
        });
      }
    }
  }

  videos.sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));
  return json({ videos }, 200, request);
}

async function exportCSV(request, env) {
  const submissions = await readAllSubmissionRecords(env);
  const rows = [["Upload ID", "Date", "Name", "Contact", "Message", "Files Count"]];

  for (const item of submissions) {
    rows.push([
      item.data.uploadId || "",
      item.data.uploadedAt || "",
      item.data.guestName || "",
      item.data.contact || "",
      item.data.message || "",
      Array.isArray(item.data.files) ? item.data.files.length : 0
    ]);
  }

  const csv = rows.map(row =>
    row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")
  ).join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="messages.csv"',
      ...corsHeaders(request)
    }
  });
}

async function serveMedia(request, env, encodedKey) {
  const key = decodeURIComponent(encodedKey);
  const object = await env.WEDDING_UPLOADS.get(key);

  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("Access-Control-Allow-Origin", request.headers.get("Origin") || "*");
  headers.set("Vary", "Origin");

  return new Response(object.body, { headers });
}

/* =========================
   ADMIN AUTH
========================= */

async function adminLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");

  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return json({ error: "Admin secrets are not configured." }, 500, request);
  }

  if (password !== env.ADMIN_PASSWORD) {
    return json({ error: "Incorrect password." }, 401, request);
  }

  const token = await signAdminToken(env.ADMIN_SESSION_SECRET);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": buildAdminCookie(token),
      ...corsHeaders(request)
    }
  });
}

async function adminLogout(request, env) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": clearAdminCookie(),
      ...corsHeaders(request)
    }
  });
}

async function adminCheck(request, env) {
  const isAuthed = await isAdminAuthenticated(request, env);
  if (!isAuthed) {
    return json({ ok: false }, 401, request);
  }
  return json({ ok: true }, 200, request);
}

async function adminList(request, env) {
  if (!(await isAdminAuthenticated(request, env))) {
    return json({ error: "Unauthorised" }, 401, request);
  }

  const submissions = await readAllSubmissionRecords(env);
  const out = submissions
    .sort((a, b) => String(b.data.uploadedAt || "").localeCompare(String(a.data.uploadedAt || "")))
    .map(item => ({
      metadataKey: item.metadataKey,
      uploadId: item.data.uploadId || "",
      uploadedAt: item.data.uploadedAt || "",
      guestName: item.data.guestName || "",
      contact: item.data.contact || "",
      message: item.data.message || "",
      files: Array.isArray(item.data.files) ? item.data.files : []
    }));

  return json({ submissions: out }, 200, request);
}

async function adminDeleteMessage(request, env) {
  if (!(await isAdminAuthenticated(request, env))) {
    return json({ error: "Unauthorised" }, 401, request);
  }

  const body = await request.json().catch(() => ({}));
  const uploadId = String(body.uploadId || "").trim();

  if (!uploadId) {
    return json({ error: "Missing uploadId" }, 400, request);
  }

  const record = await findSubmissionByUploadId(env, uploadId);
  if (!record) {
    return json({ error: "Submission not found" }, 404, request);
  }

  record.data.message = "";
  record.data.contact = "";

  await env.WEDDING_UPLOADS.put(
    record.metadataKey,
    JSON.stringify(record.data, null, 2),
    { httpMetadata: { contentType: "application/json" } }
  );

  return json({ ok: true }, 200, request);
}

async function adminDeleteSubmission(request, env) {
  if (!(await isAdminAuthenticated(request, env))) {
    return json({ error: "Unauthorised" }, 401, request);
  }

  const body = await request.json().catch(() => ({}));
  const uploadId = String(body.uploadId || "").trim();

  if (!uploadId) {
    return json({ error: "Missing uploadId" }, 400, request);
  }

  const record = await findSubmissionByUploadId(env, uploadId);
  if (!record) {
    return json({ error: "Submission not found" }, 404, request);
  }

  const files = Array.isArray(record.data.files) ? record.data.files : [];
  for (const file of files) {
    if (file.key) await env.WEDDING_UPLOADS.delete(file.key);
    if (file.thumbKey) await env.WEDDING_UPLOADS.delete(file.thumbKey);
  }

  await env.WEDDING_UPLOADS.delete(record.metadataKey);

  return json({ ok: true }, 200, request);
}

async function adminDeleteMedia(request, env) {
  if (!(await isAdminAuthenticated(request, env))) {
    return json({ error: "Unauthorised" }, 401, request);
  }

  const body = await request.json().catch(() => ({}));
  const uploadId = String(body.uploadId || "").trim();
  const key = String(body.key || "").trim();

  if (!uploadId || !key) {
    return json({ error: "Missing uploadId or key" }, 400, request);
  }

  const record = await findSubmissionByUploadId(env, uploadId);
  if (!record) {
    return json({ error: "Submission not found" }, 404, request);
  }

  const files = Array.isArray(record.data.files) ? record.data.files : [];
  const target = files.find(file => file.key === key);
  const remaining = files.filter(file => file.key !== key);

  await env.WEDDING_UPLOADS.delete(key);
  if (target?.thumbKey) {
    await env.WEDDING_UPLOADS.delete(target.thumbKey);
  }

  record.data.files = remaining;
  record.data.hasFiles = remaining.length > 0;

  await env.WEDDING_UPLOADS.put(
    record.metadataKey,
    JSON.stringify(record.data, null, 2),
    { httpMetadata: { contentType: "application/json" } }
  );

  return json({ ok: true }, 200, request);
}

async function adminBulkDelete(request, env) {
  if (!(await isAdminAuthenticated(request, env))) {
    return json({ error: "Unauthorised" }, 401, request);
  }

  const body = await request.json().catch(() => ({}));
  const uploadIds = Array.isArray(body.uploadIds)
    ? body.uploadIds.map(v => String(v || "").trim()).filter(Boolean)
    : [];

  if (!uploadIds.length) {
    return json({ error: "No uploadIds supplied" }, 400, request);
  }

  for (const uploadId of uploadIds) {
    const record = await findSubmissionByUploadId(env, uploadId);
    if (!record) continue;

    const files = Array.isArray(record.data.files) ? record.data.files : [];
    for (const file of files) {
      if (file.key) await env.WEDDING_UPLOADS.delete(file.key);
      if (file.thumbKey) await env.WEDDING_UPLOADS.delete(file.thumbKey);
    }

    await env.WEDDING_UPLOADS.delete(record.metadataKey);
  }

  return json({ ok: true, deleted: uploadIds.length }, 200, request);
}

async function adminDownloadMediaByType(request, env, wantedCategory) {
  if (!(await isAdminAuthenticated(request, env))) {
    return json({ error: "Unauthorised" }, 401, request);
  }

  const submissions = await readAllSubmissionRecords(env);

  if (!submissions.length) {
    return json({ error: "No files to download" }, 400, request);
  }

  const zipEntries = [];

  for (const submission of submissions) {
    const uploadId = submission.data.uploadId || crypto.randomUUID();
    const guestName = sanitizeFolderName(submission.data.guestName || "guest");
    const folder = `${uploadId}_${guestName}`.replace(/^_+|_+$/g, "");

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

      if (wantedCategory === "photos" && file.thumbKey) {
        const thumbObject = await env.WEDDING_UPLOADS.get(file.thumbKey);
        if (thumbObject) {
          const thumbName = buildThumbName(safeName);
          const thumbBytes = new Uint8Array(await thumbObject.arrayBuffer());

          zipEntries.push({
            name: `${folder}/thumbnails/${thumbName}`,
            data: thumbBytes
          });
        }
      }
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

async function isAdminAuthenticated(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.admin_session;
  if (!token || !env.ADMIN_SESSION_SECRET) return false;
  return await verifyAdminToken(token, env.ADMIN_SESSION_SECRET);
}

async function signAdminToken(secret) {
  const payload = JSON.stringify({
    issuedAt: Date.now(),
    nonce: crypto.randomUUID()
  });

  const payloadB64 = toBase64Url(new TextEncoder().encode(payload));
  const sig = await hmacSha256(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

async function verifyAdminToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return false;

  const [payloadB64, providedSig] = parts;
  const expectedSig = await hmacSha256(payloadB64, secret);

  return timingSafeEqual(providedSig, expectedSig);
}

async function hmacSha256(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  return toBase64Url(new Uint8Array(sig));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function buildAdminCookie(token) {
  return [
    `admin_session=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=604800"
  ].join("; ");
}

function clearAdminCookie() {
  return [
    "admin_session=",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0"
  ].join("; ");
}

function parseCookies(cookieHeader) {
  const out = {};
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    out[key] = rest.join("=");
  }
  return out;
}

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach(b => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyTurnstileToken(token, remoteIp, secret) {
  if (!secret) {
    return {
      success: false,
      "error-codes": ["missing-input-secret"]
    };
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: remoteIp
      })
    });

    return await response.json();
  } catch {
    return {
      success: false,
      "error-codes": ["internal-error"]
    };
  }
}

/* =========================
   ZIP HELPERS
========================= */

function sanitizeFileName(name) {
  return String(name || "file")
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "file";
}

function sanitizeFolderName(name) {
  return String(name || "guest")
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 80) || "guest";
}

function buildThumbName(originalName) {
  const dot = originalName.lastIndexOf(".");
  if (dot === -1) return `${originalName}_thumb.jpg`;
  return `${originalName.slice(0, dot)}_thumb${originalName.slice(dot)}`;
}

async function createZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = crc32(data);

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);

    localParts.push(localHeader, nameBytes, data);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);

    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const totalLength =
    localParts.reduce((sum, part) => sum + part.length, 0) +
    centralSize +
    endRecord.length;

  const zip = new Uint8Array(totalLength);
  let pointer = 0;

  for (const part of localParts) {
    zip.set(part, pointer);
    pointer += part.length;
  }

  for (const part of centralParts) {
    zip.set(part, pointer);
    pointer += part.length;
  }

  zip.set(endRecord, pointer);
  return zip;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/* =========================
   HELPERS
========================= */

async function readAllSubmissionRecords(env) {
  let cursor = undefined;
  const keys = [];

  do {
    const page = await env.WEDDING_UPLOADS.list({ prefix: "wedding-uploads/", cursor });
    for (const obj of page.objects) {
      if (obj.key.endsWith("submission.json")) keys.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const submissions = [];
  for (const key of keys) {
    const object = await env.WEDDING_UPLOADS.get(key);
    if (!object) continue;
    try {
      submissions.push({
        metadataKey: key,
        data: JSON.parse(await object.text())
      });
    } catch (_) {}
  }
  return submissions;
}

async function findSubmissionByUploadId(env, uploadId) {
  const submissions = await readAllSubmissionRecords(env);
  return submissions.find(item => item.data.uploadId === uploadId) || null;
}

function redactSensitiveText(text, contact = "") {
  let redacted = String(text || "");

  redacted = redacted.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[redacted email]"
  );

  redacted = redacted.replace(
    /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g,
    (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 9 ? "[redacted phone]" : match;
    }
  );

  const contactValue = String(contact || "").trim();
  if (contactValue) {
    const escaped = contactValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    redacted = redacted.replace(new RegExp(escaped, "gi"), "[redacted contact]");
  }

  return redacted;
}

function sanitizeText(value, maxLength = 500) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function stripExtension(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

function getExtension(filename) {
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function datePath() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

function mimeFromExtension(ext) {
  switch (ext) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "svg": return "image/svg+xml";
    case "heic": return "image/heic";
    case "heif": return "image/heif";
    case "mp4": return "video/mp4";
    case "mov": return "video/quicktime";
    case "m4v": return "video/x-m4v";
    case "avi": return "video/x-msvideo";
    case "wmv": return "video/x-ms-wmv";
    case "webm": return "video/webm";
    case "mkv": return "video/x-matroska";
    case "mpeg":
    case "mpg": return "video/mpeg";
    case "3gp": return "video/3gpp";
    case "mts":
    case "m2ts": return "video/mp2t";
    case "ogv": return "video/ogg";
    default: return "application/octet-stream";
  }
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin"
  };
}

function json(data, status = 200, request = new Request("https://example.com")) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(request)
    }
  });
}