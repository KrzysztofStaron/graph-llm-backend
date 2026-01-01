import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:9955',
    'https://graphai.one',
    'https://www.graphai.one',
    'https://api.graphai.one',
  ];

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Get the origin from the request
    const origin = request.headers.origin;
    const isAllowed = !origin || this.allowedOrigins.includes(origin);
    const allowOrigin = isAllowed ? origin || '*' : this.allowedOrigins[0];

    // Ensure CORS headers are always set on error responses
    response.setHeader('Access-Control-Allow-Origin', allowOrigin);
    response.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    );
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With',
    );
    response.setHeader('Access-Control-Expose-Headers', '*');

    response.status(status).json(message);
  }
}
