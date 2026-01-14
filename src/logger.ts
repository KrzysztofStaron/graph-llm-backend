import { config } from 'dotenv';
import { createLogger, format, transports } from 'winston';
import axios from 'axios';
import { getTraceContext } from './trace-context';

// Load .env file early
config();

const lokiHost = process.env.GRAPHANA_URL || process.env.LOKI_HOST;
const graphanaUser = process.env.GRAPHANA_USER;
const graphanaToken = process.env.GRAPHANA_TOKEN;
const lokiBasicAuth =
  process.env.LOKI_BASIC_AUTH ||
  (graphanaUser && graphanaToken
    ? `${graphanaUser}:${graphanaToken}`
    : undefined);

// Simple function to send log to Loki
async function sendToLoki(info: {
  message: unknown;
  level: string;
  timestamp?: string;
  traceId?: string;
  [key: string]: unknown;
}): Promise<void> {
  if (!lokiHost || !lokiBasicAuth) return;

  const traceContext = getTraceContext();
  const traceId = traceContext?.traceId || info.traceId;
  
  // Ensure traceId is in the info object before stringifying
  if (traceId && !info.traceId) {
    info.traceId = traceId;
  }
  
  const timestamp = info.timestamp || new Date().toISOString();
  const timestampNs = `${Date.parse(timestamp)}000000`;
  const message = JSON.stringify(info);

  const streamLabels: Record<string, string> = {
    app: 'graph-llm-backend',
    env: process.env.NODE_ENV || 'development',
    service: 'graph-llm-backend',
  };

  if (traceId) {
    streamLabels.traceId = traceId;
  }

  const streams = [
    {
      stream: streamLabels,
      values: [[timestampNs, message]],
    },
  ];

  try {
    await axios.post(
      `${lokiHost}/loki/api/v1/push`,
      { streams },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(lokiBasicAuth).toString('base64')}`,
        },
      },
    );
  } catch (err) {
    // Silently fail - don't break app if Loki is down
  }
}

// Custom format that sends to Loki
const lokiFormat = format((info) => {
  const traceContext = getTraceContext();
  if (traceContext) {
    info.traceId = traceContext.traceId;
    if (traceContext.clientId) {
      info.clientId = traceContext.clientId;
    }
  }
  // Send to Loki asynchronously (fire and forget)
  sendToLoki(info).catch(() => {
    // Ignore errors
  });
  return info;
})();

const loggerTransports = [
  new transports.Console({
    format: format.combine(format.colorize(), format.simple()),
  }),
];

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    lokiFormat, // Send to Loki
    format.json(),
  ),
  transports: loggerTransports,
  defaultMeta: {
    service: 'graph-llm-backend',
  },
});

export default logger;
