import { Catch, ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { applyCorsHeaders } from './cors';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    applyCorsHeaders(response, request.headers.origin);

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
