import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "teacher_session";

export function isTeacherSessionValid(request: NextRequest) {
  const secret = process.env.TEACHER_SESSION_SECRET;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!secret || !token) return false;

  const [expiresAt, signature, extra] = token.split(".");
  if (!expiresAt || !signature || extra || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;

  const expected = createHmac("sha256", secret).update(expiresAt).digest("hex");
  const signatureHash = createHash("sha256").update(signature).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(signatureHash, expectedHash);
}
