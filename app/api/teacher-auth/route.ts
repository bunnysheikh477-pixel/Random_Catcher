import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isTeacherSessionValid } from "@/lib/teacher-auth";

const COOKIE_NAME = "teacher_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 8;

function createSessionSignature(expiresAt: string, secret: string) {
  return createHmac("sha256", secret).update(expiresAt).digest("hex");
}

function matchesSecret(value: string, expected: string) {
  const valueHash = createHash("sha256").update(value).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(valueHash, expectedHash);
}

function configuredSecrets() {
  const password = process.env.TEACHER_PORTAL_PASSWORD;
  const sessionSecret = process.env.TEACHER_SESSION_SECRET;
  return password && sessionSecret ? { password, sessionSecret } : null;
}

export async function GET(request: NextRequest) {
  const secrets = configuredSecrets();
  if (!secrets) {
    return NextResponse.json({ error: "Teacher authentication is not configured." }, { status: 503 });
  }

  if (!isTeacherSessionValid(request)) {
    return NextResponse.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const secrets = configuredSecrets();
  if (!secrets) {
    return NextResponse.json({ error: "Teacher authentication is not configured." }, { status: 503 });
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.password !== "string" || body.password.length > 1024) {
    return NextResponse.json({ error: "Enter the teacher password." }, { status: 400 });
  }
  if (!matchesSecret(body.password, secrets.password)) {
    return NextResponse.json({ error: "Incorrect teacher password." }, { status: 401 });
  }

  const expiresAt = String(Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS);
  const signature = createSessionSignature(expiresAt, secrets.sessionSecret);
  const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(COOKIE_NAME, `${expiresAt}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
