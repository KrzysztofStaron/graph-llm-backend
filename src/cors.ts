export const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:9955',
  'https://graphai.one',
  'https://www.graphai.one',
  'https://api.graphai.one',
  'https://graph-llm-seven.vercel.app',
] as const;

export const CORS_ALLOW_METHODS =
  'GET, POST, PUT, DELETE, PATCH, OPTIONS';

export const CORS_ALLOW_HEADERS =
  'Content-Type, Authorization, X-Requested-With, X-Client-Id, X-Trace-Id';

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if ((ALLOWED_ORIGINS as readonly string[]).includes(origin)) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (!host.endsWith('.vercel.app')) return false;
  return (
    host === 'graph-llm-seven.vercel.app' ||
    host.startsWith('graph-llm-') ||
    host.endsWith('.krzysztof-starons-projects.vercel.app')
  );
}

export function corsAllowOrigin(
  origin: string | undefined,
): string | undefined {
  if (!origin) return '*';
  if (isAllowedOrigin(origin)) return origin;
  return undefined;
}

export function applyCorsHeaders(
  response: { setHeader: (name: string, value: string) => unknown },
  origin: string | undefined,
): void {
  const allowOrigin = corsAllowOrigin(origin);
  if (allowOrigin) {
    response.setHeader('Access-Control-Allow-Origin', allowOrigin);
  }
  response.setHeader('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
  response.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
}
