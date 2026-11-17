import type { NextFunction, Request, Response } from 'express';
import { applyCorsHeaders } from './cors';

/**
 * Vercel Functions reject request bodies above 4.5 MB. Stay under that so
 * multipart overhead still fits. Chat payloads from the frontend are capped
 * at 450 KB before they are sent.
 */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export const MAX_JSON_BODY = '4mb';

export function rejectOversizedRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const lengthHeader = req.headers['content-length'];
  if (typeof lengthHeader !== 'string') {
    next();
    return;
  }

  const length = Number(lengthHeader);
  if (!Number.isFinite(length) || length <= MAX_REQUEST_BYTES) {
    next();
    return;
  }

  applyCorsHeaders(res, req.headers.origin);
  res.status(413).json({
    error: 'Payload too large',
    details: 'Requests must be 4 MB or smaller on the serverless runtime.',
  });
}
