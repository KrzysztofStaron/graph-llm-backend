import type { Response } from 'express';

type FlushableResponse = Response & {
  flush?: () => void;
};

function flushHeaders(res: FlushableResponse): void {
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

function flushChunk(res: FlushableResponse): void {
  if (typeof res.flush === 'function') {
    res.flush();
  }
}

export function beginSseStream(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  flushHeaders(res);
}

export function beginAudioStream(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');
  flushHeaders(res);
}

export function writeSse(
  res: Response,
  encoder: TextEncoder,
  payload: string,
): void {
  res.write(encoder.encode(payload));
  flushChunk(res);
}

export function writeAudioChunk(res: Response, chunk: Uint8Array): void {
  res.write(Buffer.from(chunk));
  flushChunk(res);
}
