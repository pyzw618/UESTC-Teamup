import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** 统一响应包装：{ code: 0, data, dev? } */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data !== null && typeof data === 'object' && 'dev' in (data as Record<string, unknown>)) {
          const { dev, ...rest } = data as Record<string, unknown>;
          return { code: 0, data: rest, dev };
        }
        return { code: 0, data };
      }),
    );
  }
}
