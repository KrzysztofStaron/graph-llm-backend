import './telemetry';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';
import { TraceInterceptor } from './trace.interceptor';
import { shutdownPostHog } from './posthog.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allowed origins for CORS
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:9955',
    'https://graphai.one',
    'https://www.graphai.one',
    'https://api.graphai.one',
    'https://graph-llm-seven.vercel.app',
  ];

  // Increase body size limit to 50MB to handle large image payloads
  app.use(json({ limit: '50mb' }));

  // Enable CORS with specific origins - single source of truth for CORS configuration
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Client-Id',
      'X-Trace-Id',
    ],
    credentials: false,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400,
  });

  // Add global exception filter to ensure CORS headers on all error responses
  app.useGlobalFilters(new HttpExceptionFilter());
  // Add global trace interceptor to extract and set trace IDs
  app.useGlobalInterceptors(new TraceInterceptor());
  app.enableShutdownHooks();

  // Graceful shutdown for PostHog
  process.on('SIGTERM', async () => {
    await shutdownPostHog();
  });
  process.on('SIGINT', async () => {
    await shutdownPostHog();
  });

  await app.listen(process.env.PORT ?? 9955);
}
void bootstrap();
