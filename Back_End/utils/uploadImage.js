const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { ApiError } = require("./http");

/**
 * Image upload helper for the hotel APIs.
 * ------------------------------------------------------------------
 * Uses the project's existing `express-fileupload` + `Back_End/uploads` approach
 * (files are served from `/uploads`), but adds the hardening the transport
 * vendors skipped: an allow-list of image MIME types and random file names, so an
 * uploaded `x.jpg` cannot overwrite an unrelated file or smuggle a `.html`
 * payload into the static directory.
 */

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const MAX_BYTES = 5 * 1024 * 1024; // matches the global express-fileupload limit

const ALLOWED_TYPES = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

const ALLOWED_LABEL = "JPEG, PNG, WebP or AVIF";

const ensureUploadsDir = () => {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
};

/** Normalise `req.files.x` (single object or array) into an array. */
const toArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

/**
 * Persist one uploaded image and return its public URL.
 *
 * @param {object} file An `express-fileupload` file object
 * @param {string} prefix Filename prefix, e.g. `hotel` or `room`
 * @returns {Promise<string>} e.g. `/uploads/hotel_1712_ab12cd.jpg`
 */
const saveImage = async (file, prefix = "hotel") => {
  if (!file) throw new ApiError(400, "No image file was uploaded.");

  const extension = ALLOWED_TYPES[String(file.mimetype).toLowerCase()];
  if (!extension) {
    throw new ApiError(400, `Unsupported image type "${file.mimetype}". Allowed: ${ALLOWED_LABEL}.`);
  }
  if (file.size && file.size > MAX_BYTES) {
    throw new ApiError(400, `Image exceeds the 5MB size limit (max 5MB, ${ALLOWED_LABEL}).`);
  }

  ensureUploadsDir();

  const fileName = `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}${extension}`;
  await file.mv(path.join(UPLOADS_DIR, fileName));

  return `/uploads/${fileName}`;
};

/**
 * Delete an uploaded image from disk. Unknown or non-`/uploads` paths are
 * ignored, and `path.basename` keeps a stored URL from escaping the directory.
 */
const removeImage = (url) => {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return false;

  const filePath = path.join(UPLOADS_DIR, path.basename(url));
  if (!fs.existsSync(filePath)) return false;

  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.warn(" Could not remove uploaded image:", error.message);
    return false;
  }
};

module.exports = { UPLOADS_DIR, MAX_BYTES, ALLOWED_TYPES, ALLOWED_LABEL, toArray, saveImage, removeImage };
