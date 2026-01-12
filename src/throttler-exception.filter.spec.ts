import { ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ThrottlerExceptionFilter } from './throttler-exception.filter';
import { Request, Response } from 'express';

describe('ThrottlerExceptionFilter', () => {
  let filter: ThrottlerExceptionFilter;
  let mockArgumentsHost: ArgumentsHost;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    filter = new ThrottlerExceptionFilter();

    mockRequest = {
      headers: {},
      url: '/test',
      method: 'POST',
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as any;
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  describe('catch', () => {
    it('should return 429 status code', () => {
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(429);
    });

    it('should return rate limit error message', () => {
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again in a minute.',
        retryAfter: 60,
      });
    });

    it('should set rate limit headers', () => {
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Limit',
        '1000',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Remaining',
        '0',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    });

    it('should set CORS headers for allowed origin', () => {
      mockRequest.headers = { origin: 'http://localhost:3000' };
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://localhost:3000',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, X-Client-Id',
      );
    });

    it('should allow localhost:3000 origin', () => {
      mockRequest.headers = { origin: 'http://localhost:3000' };
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://localhost:3000',
      );
    });

    it('should allow localhost:9955 origin', () => {
      mockRequest.headers = { origin: 'http://localhost:9955' };
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://localhost:9955',
      );
    });

    it('should allow graphai.one origin', () => {
      mockRequest.headers = { origin: 'https://graphai.one' };
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://graphai.one',
      );
    });

    it('should allow www.graphai.one origin', () => {
      mockRequest.headers = { origin: 'https://www.graphai.one' };
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://www.graphai.one',
      );
    });

    it('should allow api.graphai.one origin', () => {
      mockRequest.headers = { origin: 'https://api.graphai.one' };
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://api.graphai.one',
      );
    });

    it('should allow graph-llm-seven.vercel.app origin', () => {
      mockRequest.headers = { origin: 'https://graph-llm-seven.vercel.app' };
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://graph-llm-seven.vercel.app',
      );
    });

    it('should use fallback origin for disallowed origin', () => {
      mockRequest.headers = { origin: 'https://evil.com' };
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://localhost:3000',
      );
    });

    it('should handle missing origin header', () => {
      mockRequest.headers = {};
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        '*',
      );
    });

    it('should always return retryAfter value of 60', () => {
      const exception = new ThrottlerException('Too Many Requests');

      filter.catch(exception, mockArgumentsHost);

      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.retryAfter).toBe(60);
    });

    it('should handle different throttler exception messages', () => {
      const exception = new ThrottlerException('Custom throttler message');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again in a minute.',
        retryAfter: 60,
      });
    });
  });
});
