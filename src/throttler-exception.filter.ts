import { Catch, ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const origin = request.headers.origin;
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:9955',
      'https://graphai.one',
      'https://www.graphai.one',
      'https://api.graphai.one',
      'https://graph-llm-seven.vercel.app',
    ];
    const isAllowed = !origin || allowedOrigins.includes(origin);
    const allowOrigin = isAllowed ? origin || '*' : allowedOrigins[0];

    // Set CORS headers
    response.setHeader('Access-Control-Allow-Origin', allowOrigin);
    response.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    );
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-Client-Id',
    );

    // Set rate limit headers (informational)
    response.setHeader('X-RateLimit-Limit', '1000');
    response.setHeader('X-RateLimit-Remaining', '0');
    response.setHeader('Retry-After', '60');

    response.status(429).json({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again in a minute.',
      retryAfter: 60,
    });
  }
}

