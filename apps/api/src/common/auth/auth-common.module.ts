import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { SessionService } from './session.service';
import { UserSerializer, ViewerContext } from './viewer.context';
import { ViewerMiddleware } from './viewer.middleware';

@Global()
@Module({
  providers: [SessionService, ViewerContext, UserSerializer, AuthGuard],
  exports: [SessionService, ViewerContext, UserSerializer, AuthGuard],
})
export class AuthCommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ViewerMiddleware).forRoutes('*');
  }
}
