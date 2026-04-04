const API = "/api";

const input = document.getElementById("mediaFiles");
const dropzone = document.getElementById("dropzone");
const previews = document.getElementById("previews");
const form = document.getElementById("uploadForm");
const status = document.getElementById("status");
const selection = document.getElementById("selection");
const submitBtn = document.getElementById("submitBtn");

const uploadModal = document.getElementById("uploadModal");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const uploadMessage = document.getElementById("uploadMessage");

let selectedFiles = [];

const IMAGE_MAX_DIMENSION = 2000;
const IMAGE_QUALITY = 0.82;
const THUMB_MAX_DIMENSION = 400;
const THUMB_QUALITY = 0.75;

function setStatus(type, msg) {
  status.className = "status " + type;
  status.textContent = msg;
}

function clearStatus() {
  status.className = "status";
  status.textContent = "";
}

function openUploadModal() {
  uploadModal.setAttribute("aria-hidden", "false");
  uploadModal.classList.add("open");
  document.body.classList.add("modal-open");
  progressBar.style.width = "0%";
  progressText.textContent = "0%";
  uploadMessage.textContent = "Please keep this page open while we upload everything safely.";
}

function closeUploadModal() {
  uploadModal.setAttribute("aria-hidden", "true");
  uploadModal.classList.remove("open");
  document.body.classList.remove("modal-open");
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function isImageFile(file) {
  return file.type.startsWith("image/");
}

function isVideoFile(file) {
  return file.type.startsWith("video/");
}

function getOutputImageType() {
  return "image/jpeg";
}

function getCompressedFilename(file, suffix = "") {
  const original = file.name.replace(/\.[^.]+$/, "");
  return `${original}${suffix}.jpg`;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function loadImage(file) {
  return new Promise(async (resolve, reject) => {
    try {
      const dataUrl = await readFileAsDataURL(file);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load image ${file.name}`));
      img.src = dataUrl;
    } catch (err) {
      reject(err);
    }
  });
}

function fitDimensions(width, height, maxDimension) {
  let w = width;
  let h = height;

  if (w > h) {
    if (w > maxDimension) {
      h = Math.round((h * maxDimension) / w);
      w = maxDimension;
    }
  } else {
    if (h > maxDimension) {
      w = Math.round((w * maxDimension) / h);
      h = maxDimension;
    }
  }

  return { width: w, height: h };
}

async function renderImageToFile(file, maxDimension, quality, suffix = "") {
  const img = await loadImage(file);
  const { width, height } = fitDimensions(img.width, img.height, maxDimension);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const outputType = getOutputImageType(file);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, outputType, quality);
  });

  if (!blob) {
    throw new Error(`Could not process ${file.name}`);
  }

  return new File(
    [blob],
    getCompressedFilename(file, suffix),
    { type: outputType, lastModified: Date.now() }
  );
}

async function compressImage(file) {
  return renderImageToFile(file, IMAGE_MAX_DIMENSION, IMAGE_QUALITY, "");
}

async function createThumbnail(file) {
  return renderImageToFile(file, THUMB_MAX_DIMENSION, THUMB_QUALITY, "_thumb");
}

async function prepareFiles(files) {
  const prepared = [];

  for (const file of Array.from(files)) {
    if (isImageFile(file)) {
      try {
        const compressed = await compressImage(file);
        const thumb = await createThumbnail(file);
        compressed._thumbnail = thumb;
        prepared.push(compressed);
      } catch (_) {
        prepared.push(file);
      }
    } else {
      prepared.push(file);
    }
  }

  return prepared;
}

function previewFiles(files) {
  previews.innerHTML = "";

  if (!files.length) {
    selection.textContent = "No files selected";
    return;
  }

  selection.textContent = files.length + " file(s) selected";

  Array.from(files).forEach((file) => {
    const div = document.createElement("div");
    div.className = "preview";

    let media;

    if (isImageFile(file)) {
      media = document.createElement("img");
      const reader = new FileReader();
      reader.onload = (e) => {
        media.src = e.target.result;
      };
      reader.readAsDataURL(file);
    } else if (isVideoFile(file)) {
      media = document.createElement("video");
      media.src = URL.createObjectURL(file);
      media.muted = true;
      media.playsInline = true;
      media.preload = "metadata";
    } else {
      media = document.createElement("div");
      media.textContent = "🎞️";
    }

    const meta = document.createElement("div");
    meta.className = "preview-meta";
    meta.textContent = `${file.name} • ${formatFileSize(file.size)}`;

    div.appendChild(media);
    div.appendChild(meta);
    previews.appendChild(div);
  });
}

async function setFiles(files) {
  selectedFiles = await prepareFiles(files);
  previewFiles(selectedFiles);
}

function resetTurnstile() {
  const responseInput = document.querySelector('[name="cf-turnstile-response"]');
  if (responseInput) responseInput.value = "";

  if (window.turnstile) {
    try {
      window.turnstile.reset();
    } catch (_) {}
  }
}

input.addEventListener("change", async () => {
  await setFiles(input.files);
});

dropzone.addEventListener("click", () => input.click());

dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    input.click();
  }
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  await setFiles(e.dataTransfer.files);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const files = selectedFiles;
  const message = document.getElementById("message").value.trim();
  const guestName = document.getElementById("guestName").value.trim();
  const contact = document.getElementById("contact").value.trim();
  const turnstileToken =
    document.querySelector('[name="cf-turnstile-response"]')?.value?.trim() || "";

  if (!files.length && !message && !guestName && !contact) {
    setStatus("error", "Please upload something or leave a message");
    return;
  }

  if (!turnstileToken) {
    resetTurnstile();
    setStatus("error", "Please complete the human check again, then press Send.");
    return;
  }

  const data = new FormData();

  files.forEach((f) => {
    data.append("media", f);
    if (f._thumbnail) {
      data.append("thumb", f._thumbnail);
    }
  });

  data.append("guestName", guestName);
  data.append("contact", contact);
  data.append("message", message);
  data.append("turnstileToken", turnstileToken);

  submitBtn.disabled = true;
  openUploadModal();

  try {
    const result = await uploadWithProgress(API + "/upload", data, (percent) => {
      progressBar.style.width = percent + "%";
      progressText.textContent = percent + "%";

      if (percent >= 100) {
        uploadMessage.textContent = "Finalising your upload...";
      }
    });

    form.reset();
    selectedFiles = [];
    previews.innerHTML = "";
    selection.textContent = "No files selected";
    setStatus("success", result.message || "Thank you! 💛");
    resetTurnstile();
  } catch (err) {
    setStatus("error", err.message || "Upload failed");
    resetTurnstile();
  } finally {
    closeUploadModal();
    submitBtn.disabled = false;
  }
});

function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener("load", () => {
      const raw = xhr.responseText || "";

      let response = {};
      try {
        response = JSON.parse(raw);
      } catch (_) {}

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(response);
      } else {
        reject(new Error(response.error || raw || `Upload failed (${xhr.status})`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.send(formData);
  });
}