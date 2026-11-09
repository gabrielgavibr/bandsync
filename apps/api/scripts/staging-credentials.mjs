#!/usr/bin/env node
/**
 * Generates credentials that exist ONLY for the staging environment and a matching seed file.
 *
 *   node scripts/staging-credentials.mjs     # writes .staging/credentials.txt, access-key.txt, seed.sql
 *
 * - A random access key for the staging gate (secret STAGING_ACCESS_KEY).
 * - A random password per demo account, hashed with PBKDF2 at the staging iteration count.
 * - seed.sql = the fictional demo data + UPDATE statements that set the new password hashes,
 *   so running it again rotates the passwords of an existing staging database.
 * Everything is written to apps/api/.staging/, which is git-ignored. Nothing here is committed.
 */
import { randomInt, webcrypto } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ITERATIONS = Number(process.env.STAGING_PBKDF2_ITERATIONS ?? 10000);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".staging");

const ACCOUNTS = [
  {
    id: "demo-user-ana",
    email: "ana@bandsync.demo",
    name: "Ana Ribeiro",
    role: "admin, conductor (drums)",
  },
  {
    id: "demo-user-bruno",
    email: "bruno@bandsync.demo",
    name: "Bruno Costa",
    role: "member, may conduct (bass)",
  },
  {
    id: "demo-user-carla",
    email: "carla@bandsync.demo",
    name: "Carla Mendes",
    role: "member, cannot conduct (vocals)",
  },
  {
    id: "demo-user-diego",
    email: "diego@bandsync.demo",
    name: "Diego Alves",
    role: "member, cannot edit songs (guitar)",
  },
];

function pick(alphabet, n) {
  let s = "";
  for (let i = 0; i < n; i += 1) s += alphabet[randomInt(alphabet.length)];
  return s;
}
const groups = (s, size) => s.match(new RegExp(`.{1,${size}}`, "g")).join("-");
const b64url = (u) =>
  Buffer.from(u).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// No 0/O/1/I/L so the key reads unambiguously on a phone.
const accessKey = groups(pick("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 16), 4); // ~79 bits

async function hash(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = new Uint8Array(
    await webcrypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
      key,
      256,
    ),
  );
  return `pbkdf2$sha256$${ITERATIONS}$${b64url(salt)}$${b64url(bits)}`;
}

const creds = [];
for (const a of ACCOUNTS) {
  const password = groups(pick("abcdefghjkmnpqrstuvwxyz23456789", 20), 5); // ~99 bits
  creds.push({ ...a, password, hash: await hash(password) });
}

const now = new Date().toISOString();
const demo = readFileSync(join(root, "seed", "demo.sql"), "utf8");
const updates = creds
  .map(
    (c) =>
      `UPDATE users SET password_hash = '${c.hash}', updated_at = '${now}' WHERE id = '${c.id}';`,
  )
  .join("\n");
const ids = creds.map((c) => `'${c.id}'`).join(", ");
const seed = `-- GENERATED for staging by scripts/staging-credentials.mjs. Do not commit.
${demo}

-- Staging-only passwords: the public demo password is replaced and existing sessions are revoked.
${updates}
DELETE FROM auth_sessions WHERE user_id IN (${ids});
`;

const text = [
  "BandSync staging credentials. Keep private: do not commit, do not post in public channels.",
  `Generated: ${now}`,
  "",
  `Access key (first screen): ${accessKey}`,
  "",
  "Accounts (band “Sala 3”):",
  ...creds.map((c) => `  ${c.email.padEnd(22)} ${c.password}   ${c.name}: ${c.role}`),
  "",
].join("\n");

mkdirSync(outDir, { recursive: true });
const files = { "seed.sql": seed, "access-key.txt": `${accessKey}\n`, "credentials.txt": text };
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(outDir, name), content, { mode: 0o600 });
  chmodSync(join(outDir, name), 0o600);
}
console.log(
  `Wrote ${Object.keys(files).join(", ")} to ${outDir} (PBKDF2 ${ITERATIONS} iterations).`,
);
