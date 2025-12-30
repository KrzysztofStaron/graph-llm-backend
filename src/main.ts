import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase body size limit to 50MB to handle large image payloads
  app.use(json({ limit: '50mb' }));

  // Enable CORS - Allow all origins
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Content-Encoding'],
    credentials: true,
  });

  // Add global exception filter to ensure CORS headers on all error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.PORT ?? 9955);
}
void bootstrap();
