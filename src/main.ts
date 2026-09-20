import './telemetry';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';
import { TraceInterceptor } from './trace.interceptor';
import { shutdownPostHog } from './posthog.service';
import { isAllowedOrigin } from './cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(json({ limit: '50mb' }));

  app.enableCors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
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
