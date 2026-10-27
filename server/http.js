import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, title, detail, errors) {
    super(detail || title);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.errors = errors;
  }
}

export const notFound = (what = 'Item') => new HttpError(404, 'Not found', `${what} not found.`);
export const badRequest = (detail, errors) => new HttpError(400, 'Invalid request', detail, errors);
export const forbidden = (detail = 'You do not have permission to do that.') =>
  new HttpError(403, 'Forbidden', detail);

/** Parse `data` with a zod schema or throw a 400 listing each bad field. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    errors[key] ??= issue.message;
  }
  throw badRequest('Some fields need fixing.', errors);
}

export function id(value, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw notFound(what);
  return n;
}

/** Problem Details (RFC 9457) error responses. */
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).type('application/problem+json').json({
      type: 'about:blank',
      title: err.title,
      status: err.status,
      detail: err.detail,
      ...(err.errors ? { errors: err.errors } : {}),
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).type('application/problem+json').json({
      type: 'about:blank', title: 'Invalid request', status: 400, detail: 'Request body is not valid JSON.',
    });
  }
  console.error(err);
  res.status(500).type('application/problem+json').json({
    type: 'about:blank', title: 'Server error', status: 500, detail: 'Something went wrong on the server.',
  });
}

// Shared field schemas
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #5b5bd6');
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-03')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Not a real date');
export const name = (max = 120) => z.string().trim().min(1, 'Required').max(max, `Keep it under ${max} characters`);
