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
  document.body.classList.add("modal-open");
  progressBar.style.width = "0%";
  progressText.textContent = "0%";
  uploadMessage.textContent = "Please keep this page open while we upload everything safely.";
}

function closeUploadModal() {
  uploadModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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

    if (file.type.startsWith("image/")) {
      media = document.createElement("img");
      const reader = new FileReader();
      reader.onload = (e) => {
        media.src = e.target.result;
      };
      reader.readAsDataURL(file);
    } else if (file.type.startsWith("video/")) {
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

function setFiles(files) {
  const dt = new DataTransfer();
  Array.from(files).forEach((file) => dt.items.add(file));
  input.files = dt.files;
  previewFiles(input.files);
}

input.addEventListener("change", () => {
  previewFiles(input.files);
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

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  setFiles(e.dataTransfer.files);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const files = input.files;
  const message = document.getElementById("message").value.trim();
  const guestName = document.getElementById("guestName").value.trim();
  const contact = document.getElementById("contact").value.trim();

  if (!files.length && !message && !guestName && !contact) {
    setStatus("error", "Please upload something or leave a message");
    return;
  }

  const data = new FormData();
  Array.from(files).forEach((f) => data.append("media", f));
  data.append("guestName", guestName);
  data.append("contact", contact);
  data.append("message", message);

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
    previews.innerHTML = "";
    selection.textContent = "No files selected";
    setStatus("success", result.message || "Thank you! 💛");
  } catch (err) {
    setStatus("error", err.message || "Upload failed");
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
      let response = {};
      try {
        response = JSON.parse(xhr.responseText || "{}");
      } catch (_) {}

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(response);
      } else {
        reject(new Error(response.error || "Upload failed"));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.send(formData);
  });
}