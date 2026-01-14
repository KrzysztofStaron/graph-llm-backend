import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  runWithTraceContext,
  type TraceContext,
} from './trace-context';

@Injectable()
export class TraceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const traceId =
      (request.headers['x-trace-id'] as string) ||
      this.generateTraceId();
    const clientId = request.headers['x-client-id'] as string | undefined;

    const traceContext: TraceContext = {
      traceId,
      clientId,
    };

    return runWithTraceContext(traceContext, () => next.handle());
  }

  private generateTraceId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  }
}

