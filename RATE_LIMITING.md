# Rate Limiting Configuration

## Overview

Rate limiting has been implemented using `@nestjs/throttler` with very generous limits to prevent abuse while allowing normal usage patterns.

## Rate Limits

### Default Limit
- **1000 requests per minute per IP**
- Applied to all endpoints by default
- Very generous to allow normal usage

### Endpoint-Specific Limits

#### Chat Endpoints
- **POST `/api/v1/chat`**: 1000 requests/minute
- **POST `/api/v1/chat/stream`**: 1000 requests/minute
- These are the most frequently used endpoints, so they have the highest limit

#### Text-to-Speech
- **POST `/api/v1/text-to-speech`**: 500 requests/minute
- Generous limit for TTS requests

#### Document Parsing
- **POST `/api/v1/document/parse`**: 200 requests/minute
- Lower limit due to higher resource usage (file parsing)

#### Other Endpoints
- **GET `/api/v1/collaboration`**: Uses default (1000/minute)
- **GET `/`**: Uses default (1000/minute)

## Implementation Details

### Configuration
- Rate limiting is configured in `app.module.ts`
- Uses sliding window approach (1 minute windows)
- Limits are per IP address
- Applied globally via `APP_GUARD`

### Error Handling
- Custom `ThrottlerExceptionFilter` provides user-friendly error messages
- Returns HTTP 429 (Too Many Requests) when limit exceeded
- Includes rate limit headers:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Remaining requests in current window
  - `Retry-After`: Seconds until limit resets

### Error Response Format
```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please try again in a minute.",
  "retryAfter": 60
}
```

## Adjusting Limits

To adjust rate limits, modify the configuration in `app.module.ts`:

```typescript
ThrottlerModule.forRoot([
  {
    name: 'default',
    ttl: 60000, // Time window in milliseconds
    limit: 1000, // Number of requests allowed
  },
  // ... other configurations
])
```

### For Specific Endpoints

Use the `@Throttle()` decorator on controller methods:

```typescript
@Throttle({ default: { limit: 500, ttl: 60000 } })
@Post('endpoint')
async handler() {
  // ...
}
```

## Monitoring

Rate limit violations are logged through the existing logger. Monitor for:
- Frequent 429 responses
- Patterns indicating abuse
- Legitimate users hitting limits

## Notes

- Limits are per IP address
- Limits reset every minute (sliding window)
- Very generous limits to avoid impacting legitimate users
- Can be adjusted based on usage patterns and abuse detection

