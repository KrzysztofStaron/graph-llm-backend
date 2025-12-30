import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS middleware - Set headers on ALL requests before anything else
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');

    // Handle preflight requests immediately
    if (req.method === 'OPTIONS') {
      res.status(204).send();
      return;
    }

    next();
  });

  // Increase body size limit to 50MB to handle large image payloads
  app.use(json({ limit: '50mb' }));

  // Enable CORS - Allow everything (backup, but middleware above handles it)
  app.enableCors({
    origin: '*',
    methods: '*',
    allowedHeaders: '*',
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
