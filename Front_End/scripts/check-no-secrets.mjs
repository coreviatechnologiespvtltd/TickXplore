/**
 * Fails the build if a secret is about to be shipped to the browser.
 * ------------------------------------------------------------------
 * Vite inlines every `VITE_*` variable into the public JavaScript bundle. Anything
 * in that list is readable by anyone who opens the site, so a real secret must
 * never be a `VITE_` variable. The chatbot used to break this rule by exposing
 * `VITE_HF_API_KEY`; this check exists so it cannot happen again quietly.
 *
 * Run it with:  npm run check:secrets
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Directories that never contain our source and would only slow the scan down. */
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".cache",
  "coverage",
  ".next",
]);

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".env",
]);

/** Variable names that must never be exposed to the browser. */
const FORBIDDEN_BROWSER_VARS = [
  "VITE_HF_API_KEY",
  "VITE_HUGGINGFACE_API_KEY",
  "VITE_OPENAI_API_KEY",
  "VITE_ANTHROPIC_API_KEY",
  "VITE_GEMINI_API_KEY",
  "VITE_MONGO_URI",
  "VITE_MONGODB_URI",
  "VITE_JWT_SECRET",
  "VITE_JWT_REFRESH_SECRET",
  "VITE_KHALTI_SECRET_KEY",
  "VITE_EMAIL_PASS",
];

/**
 * A value that looks like a live provider token, whatever it is called.
 * This catches a secret that is renamed to dodge the list above.
 */
const SECRET_VALUE_PATTERNS = [
  { label: "Hugging Face token", pattern: /\bhf_[A-Za-z0-9]{20,}\b/g },
  { label: "OpenAI key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: "MongoDB connection string", pattern: /mongodb(\+srv)?:\/\/[^\s"']+/g },
];

/** Firebase web config values are designed to be public; don't flag them. */
const ALLOWED_PUBLIC_VALUES = new Set(["AIzaSyBYthnPPlkZ83h9d8qnLSARn2rw6-m1yN4"]);

/** Files that legitimately mention these names while explaining how to avoid them. */
const SELF_REFERENTIAL = [/(check-no-secrets|^\.env\.example|README|chatbot-rag\.md)/];

const isScannable = (filePath) => {
  const name = filePath.split(/[\\/]/).pop() || "";
  if (name === ".env" || name.endsWith(".env")) return true;
  return SCANNED_EXTENSIONS.has(extname(filePath));
};

const collectFiles = (dir, found = []) => {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, found);
    } else if (isScannable(full)) {
      found.push(full);
    }
  }
  return found;
};

/** Lines that document the rule rather than break it. */
const isExplanatory = (file, line) =>
  SELF_REFERENTIAL.some((pattern) => pattern.test(file)) ||
  /^\s*(\/\/|\/\*|\*|#)/.test(line) ||
  /\bnever\b|\bdo not\b|\bdon't\b|exposed to the browser|readable by/i.test(line);

const problems = [];

for (const file of collectFiles(ROOT)) {
  const relativePath = relative(ROOT, file).split("\\").join("/");
  const lines = readFileSync(file, "utf-8").split("\n");

  lines.forEach((line, index) => {
    if (isExplanatory(relativePath, line)) return;

    for (const name of FORBIDDEN_BROWSER_VARS) {
      // Only a real assignment counts, not the word appearing in a comment.
      if (new RegExp(`^\\s*(export\\s+)?(const\\s+)?${name}\\s*[:=]`).test(line)) {
        problems.push(
          `${relativePath}:${index + 1} assigns ${name}, which is compiled into the public bundle.`
        );
      }
      if (/import\.meta\.env\./.test(line) && line.includes(name)) {
        problems.push(
          `${relativePath}:${index + 1} reads ${name} from import.meta.env in browser code.`
        );
      }
    }

    for (const { label, pattern } of SECRET_VALUE_PATTERNS) {
      const matches = line.match(pattern);
      if (!matches) continue;
      for (const match of matches) {
        if (ALLOWED_PUBLIC_VALUES.has(match)) continue;
        problems.push(
          `${relativePath}:${index + 1} contains a ${label} in browser-reachable code.`
        );
      }
    }
  });
}

if (problems.length > 0) {
  console.error("Secret check failed. These must not reach the browser:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nMove the value to the backend and read it from the server environment instead."
  );
  process.exit(1);
}

console.log("Secret check passed: no API keys or server secrets in browser code.");
