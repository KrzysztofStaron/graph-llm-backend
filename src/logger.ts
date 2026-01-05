import { config } from 'dotenv';
import { createLogger, format, transports } from 'winston';
import axios from 'axios';

// Load .env file early
config();

const lokiHost = process.env.GRAPHANA_URL || process.env.LOKI_HOST;
const graphanaUser = process.env.GRAPHANA_USER;
const graphanaToken = process.env.GRAPHANA_TOKEN;
const lokiBasicAuth =
  process.env.LOKI_BASIC_AUTH ||
  (graphanaUser && graphanaToken ? `${graphanaUser}:${graphanaToken}` : undefined);

// Simple function to send log to Loki
async function sendToLoki(info: { message: unknown; level: string; timestamp?: string; [key: string]: unknown }): Promise<void> {
  if (!lokiHost || !lokiBasicAuth) return;

  const timestamp = info.timestamp || new Date().toISOString();
  const timestampNs = `${Date.parse(timestamp)}000000`;
  const message = JSON.stringify(info);

  const streams = [
    {
      stream: {
        app: 'graph-llm-backend',
        env: process.env.NODE_ENV || 'development',
        service: 'graph-llm-backend',
      },
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
