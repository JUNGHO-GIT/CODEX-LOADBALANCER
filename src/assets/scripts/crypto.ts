import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// 1. Encrypt ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function encryptToken(plainText: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

// 2. Decrypt ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function decryptToken(value: string, key: Buffer): string {
  const raw = Buffer.from(value, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
