const path = require("path");
const fs = require("fs");

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]);
const MAX_FILENAME_LENGTH = 255;

function sanitizeFilename(filename) {
  const basename = path.basename(filename);
  const ext = path.extname(basename).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File type not allowed: ${ext}`);
  }

  const nameWithoutExt = path.basename(basename, ext);
  const sanitizedName = nameWithoutExt
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .substring(0, MAX_FILENAME_LENGTH - ext.length);

  return `${sanitizedName}${ext}`;
}

function generateUniqueFilename(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}_${random}${ext}`;
}

function ensureUploadDir(uploadDir) {
  const resolvedDir = path.resolve(uploadDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }
  return resolvedDir;
}

function isPathSafe(resolvedPath, allowedBaseDir) {
  const resolvedBase = path.resolve(allowedBaseDir);
  const normalizedResolved = path.normalize(resolvedPath);

  return normalizedResolved.startsWith(resolvedBase + path.sep) || normalizedResolved === resolvedBase;
}

async function safeUpload(file, options = {}) {
  const {
    uploadDir = path.join(__dirname, "../uploads"),
    allowedExtensions = ALLOWED_EXTENSIONS,
    maxFileSize = 5 * 1024 * 1024,
    generateUnique = true,
  } = options;

  if (!file) {
    throw new Error("No file provided");
  }

  if (file.size > maxFileSize) {
    throw new Error(`File size exceeds limit of ${maxFileSize} bytes`);
  }

  const safeUploadDir = ensureUploadDir(uploadDir);

  const originalName = file.name || "upload";
  const finalName = generateUnique ? generateUniqueFilename(originalName) : sanitizeFilename(originalName);

  const filePath = path.join(safeUploadDir, finalName);

  if (!isPathSafe(filePath, safeUploadDir)) {
    throw new Error("Invalid file path: path traversal detected");
  }

  await file.mv(filePath);

  const relativePath = `/uploads/${finalName}`;

  return {
    filename: finalName,
    filepath: filePath,
    relativePath,
    originalName,
  };
}

async function safeDelete(relativePath, uploadDir = path.join(__dirname, "../uploads")) {
  if (!relativePath || !relativePath.startsWith("/uploads/")) {
    return false;
  }

  const filename = path.basename(relativePath);
  const safeUploadDir = ensureUploadDir(uploadDir);
  const filePath = path.join(safeUploadDir, filename);

  if (!isPathSafe(filePath, safeUploadDir)) {
    return false;
  }

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }

  return false;
}

module.exports = {
  safeUpload,
  safeDelete,
  sanitizeFilename,
  generateUniqueFilename,
  ALLOWED_EXTENSIONS,
};