import type { APIResponse } from '@playwright/test';

/** Three base64url segments separated by dots. */
export const JWT_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/** Value for an `Authorization: Basic ...` header. */
export function basicAuth(email: string, password: string): string {
  return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;
}

/** Decode (without verifying) the payload of a JWT. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/** Return the token with its signature altered, so it no longer verifies. */
export function tamperSignature(token: string): string {
  const [header, payload, signature] = token.split('.');
  const last = signature.at(-1) === 'A' ? 'B' : 'A';
  return [header, payload, `${signature.slice(0, -1)}${last}`].join('.');
}

/** Wait long enough for a token issued with `expires_in: seconds` to be expired. */
export function waitForExpiry(seconds = 1): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1_000 + 1_100));
}

/** All `Set-Cookie` header values of a response. */
export function setCookies(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter(({ name }) => name.toLowerCase() === 'set-cookie')
    .map(({ value }) => value);
}

/** The `Set-Cookie` value for the given cookie name, if any. */
export function setCookieFor(response: APIResponse, name: string): string | undefined {
  return setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));
}
