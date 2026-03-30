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

    if (url.pathname.startsWith("/media/") && request.method === "GET") {
      return await serveMedia(request, env, url.pathname.substring("/media/".length));
    }

    return new Response("Not found", { status: 404 });
  }
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
  "jpg","jpeg","png","gif","webp","bmp","svg","heic","heif",
  "mp4","mov","m4v","avi","wmv","webm","mkv","mpeg","mpg","3gp","mts","m2ts","ogv"
];

async function handleUpload(request, env) {
  const formData = await request.formData();

  const uploads = formData.getAll("media").filter(item => item instanceof File && item.name);
  const guestName = sanitizeText(formData.get("guestName"));
  const contact = sanitizeText(formData.get("contact"));
  const message = sanitizeText(formData.get("message"), 1500);

  if (!uploads.length && !guestName && !contact && !message) {
    return json({ error: "Please upload at least one file or leave a message." }, 400, request);
  }

  const uploadId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const saved = [];

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

    saved.push({
      key,
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
  const submissions = await readAllSubmissions(env);

  const messages = submissions
    .filter(item => item.message || item.guestName || item.contact || (item.files && item.files.length))
    .sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")))
    .map(item => ({
      uploadId: item.uploadId || "",
      uploadedAt: item.uploadedAt || "",
      guestName: item.guestName || "",
      message: redactSensitiveText(item.message || "", item.contact || ""),
      filesCount: Array.isArray(item.files) ? item.files.length : 0,
      hasPhotos: Array.isArray(item.files) ? item.files.some(f => String(f.category || "").startsWith("photo")) : false,
      hasVideos: Array.isArray(item.files) ? item.files.some(f => String(f.category || "").startsWith("video")) : false
    }));

  return json({ messages }, 200, request);
}

async function listGallery(request, env) {
  const submissions = await readAllSubmissions(env);
  const photos = [];

  for (const item of submissions) {
    const files = Array.isArray(item.files) ? item.files : [];
    for (const file of files) {
      const type = String(file.type || "");
      const category = String(file.category || "");
      if (type.startsWith("image/") || category === "photos") {
        photos.push({
          uploadId: item.uploadId || "",
          uploadedAt: item.uploadedAt || "",
          guestName: item.guestName || "",
          originalName: file.originalName || "",
          key: file.key,
          url: `${new URL(request.url).origin}/media/${encodeURIComponent(file.key)}`
        });
      }
    }
  }

  photos.sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));
  return json({ photos }, 200, request);
}

async function listVideos(request, env) {
  const submissions = await readAllSubmissions(env);
  const videos = [];

  for (const item of submissions) {
    const files = Array.isArray(item.files) ? item.files : [];
    for (const file of files) {
      const type = String(file.type || "");
      const category = String(file.category || "");
      if (type.startsWith("video/") || category === "videos") {
        videos.push({
          uploadId: item.uploadId || "",
          uploadedAt: item.uploadedAt || "",
          guestName: item.guestName || "",
          originalName: file.originalName || "",
          key: file.key,
          url: `${new URL(request.url).origin}/media/${encodeURIComponent(file.key)}`
        });
      }
    }
  }

  videos.sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));
  return json({ videos }, 200, request);
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

async function exportCSV(request, env) {
  const submissions = await readAllSubmissions(env);
  const rows = [["Upload ID","Date","Name","Contact","Message","Files Count"]];

  for (const item of submissions) {
    rows.push([
      item.uploadId || "",
      item.uploadedAt || "",
      item.guestName || "",
      item.contact || "",
      item.message || "",
      Array.isArray(item.files) ? item.files.length : 0
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

async function readAllSubmissions(env) {
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
      submissions.push(JSON.parse(await object.text()));
    } catch (_) {}
  }
  return submissions;
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