import { expect as baseExpect, type APIResponse } from '@playwright/test';
import type { ValidationError } from '../api/types';

async function bodyPreview(response: APIResponse): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 1_000 ? `${text.slice(0, 1_000)}…` : text;
  } catch {
    return '<no body>';
  }
}

/**
 * Custom matchers for API responses. Failures include the method/URL and the response body,
 * which makes a wrong status code much easier to diagnose than `expect(res.status()).toBe(...)`.
 */
export const expect = baseExpect.extend({
  async toHaveStatus(response: APIResponse, expected: number) {
    const actual = response.status();
    const pass = actual === expected;
    const body = pass ? '' : await bodyPreview(response);
    return {
      pass,
      name: 'toHaveStatus',
      expected,
      actual,
      message: () =>
        `${this.utils.matcherHint('toHaveStatus', undefined, undefined, { isNot: this.isNot })}\n\n` +
        `Request:  ${response.url()}\n` +
        `Expected: ${this.isNot ? 'not ' : ''}${expected}\n` +
        `Received: ${actual}\n` +
        (body ? `Body:     ${body}` : ''),
    };
  },

  /** `{"detail": "..."}` error with the given status; `detail` may be matched by substring or RegExp. */
  async toBeApiError(response: APIResponse, expected: number, detail?: string | RegExp) {
    const actual = response.status();
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const message = (payload as { detail?: unknown } | undefined)?.detail;
    const statusOk = actual === expected;
    const shapeOk = message !== undefined;
    const detailOk =
      detail === undefined ||
      (typeof message === 'string' &&
        (typeof detail === 'string'
          ? message.toLowerCase().includes(detail.toLowerCase())
          : detail.test(message)));
    const pass = statusOk && shapeOk && detailOk;
    return {
      pass,
      name: 'toBeApiError',
      expected: { status: expected, detail },
      actual: { status: actual, body: payload },
      message: () =>
        `${this.utils.matcherHint('toBeApiError', undefined, undefined, { isNot: this.isNot })}\n\n` +
        `Request:  ${response.url()}\n` +
        `Expected: ${expected}${detail ? ` with detail ${String(detail)}` : ''}\n` +
        `Received: ${actual} ${JSON.stringify(payload)}`,
    };
  },

  /** 422 whose `detail` list contains an error located at the given field (e.g. `'sku'` or `['body', 'sku']`). */
  async toHaveValidationErrorFor(response: APIResponse, field: string | (string | number)[]) {
    const actual = response.status();
    let errors: ValidationError[] = [];
    try {
      const payload = (await response.json()) as { detail?: unknown };
      errors = Array.isArray(payload.detail) ? (payload.detail as ValidationError[]) : [];
    } catch {
      errors = [];
    }
    const path = Array.isArray(field) ? field.map(String) : null;
    const matches = errors.some((error) => {
      const loc = error.loc.map(String);
      return path
        ? path.every((part, i) => loc[loc.length - path.length + i] === part)
        : loc.at(-1) === field;
    });
    const pass = actual === 422 && matches;
    return {
      pass,
      name: 'toHaveValidationErrorFor',
      expected: field,
      actual: errors.map((error) => error.loc.join('.')),
      message: () =>
        `${this.utils.matcherHint('toHaveValidationErrorFor', undefined, undefined, { isNot: this.isNot })}\n\n` +
        `Request:  ${response.url()}\n` +
        `Expected: 422 with an error for ${JSON.stringify(field)}\n` +
        `Received: ${actual} with errors at ${JSON.stringify(errors.map((error) => error.loc.join('.')))}`,
    };
  },
});
