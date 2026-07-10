import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

// Envelope encryption for config secrets stored in the DB (OAuth client secrets,
// SMTP passwords). The key is DERIVED from BETTER_AUTH_SECRET (HKDF-SHA256) so no
// extra env var is needed, and — per OWASP key-separation — the key never lives in
// the database it protects: a DB leak alone cannot decrypt these values.
//
// Kept free of Nest/TypeORM imports so auth.ts (loaded outside DI, and by the
// better-auth CLI during migrations) can import it safely.
const INFO = "podokit-auth-config-v1"; // domain separation for the derived key
const ALGO = "aes-256-gcm";

function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET ?? "change-me-in-production-min-32-characters";
  // salt is intentionally empty: the info string provides domain separation and the
  // input secret is already high-entropy. Returns a 32-byte key for AES-256.
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), new Uint8Array(0), Buffer.from(INFO), 32));
}

/** Encrypt a secret for at-rest storage. Returns "iv|authTag|ciphertext" (base64 parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce, recommended for GCM
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64")).join("|");
}

/** Decrypt a value produced by {@link encryptSecret}. Throws on tampering or a wrong key. */
export function decryptSecret(envelope: string): string {
  const [iv, authTag, ciphertext] = envelope.split("|").map((part) => Buffer.from(part, "base64"));
  if (!iv || !authTag || !ciphertext) throw new Error("malformed secret envelope");
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
