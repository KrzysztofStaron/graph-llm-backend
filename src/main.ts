import './telemetry';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allowed origins for CORS
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:9955',
    'https://graphai.one',
    'https://www.graphai.one',
    'https://api.graphai.one',
  ];

  // CORS middleware - Set headers on ALL requests before anything else
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    // Check if origin is allowed, or allow all in development
    const isAllowed = !origin || allowedOrigins.includes(origin);
    const allowOrigin = isAllowed ? (origin || '*') : allowedOrigins[0];

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-Client-Id',
    );
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Access-Control-Allow-Credentials', 'false');

    // Handle preflight requests immediately
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  // Increase body size limit to 50MB to handle large image payloads
  app.use(json({ limit: '50mb' }));

  // Enable CORS with specific origins
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Client-Id'],
    exposedHeaders: '*',
    credentials: false,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Add global exception filter to ensure CORS headers on all error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.PORT ?? 9955);
}
void bootstrap();
