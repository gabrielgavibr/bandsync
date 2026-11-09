import { base64url, fromBase64url } from "./ids";

/**
 * Password hashing with PBKDF2-SHA256 via Web Crypto (the only KDF natively available in Workers).
 * The hash string embeds its parameters so iterations can be raised later without breaking logins:
 *   pbkdf2$sha256$<iterations>$<salt b64url>$<hash b64url>
 */
export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derive(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${base64url(salt)}$${base64url(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const salt = fromBase64url(parts[3]!);
  const expected = fromBase64url(parts[4]!);
  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
