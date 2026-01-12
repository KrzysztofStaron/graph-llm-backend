import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { DocumentModule } from './document/document.module';
import { CollaborationModule } from './collaboration/collaboration.module';
import { ChatModule } from './chat/chat.module';
import { TtsModule } from './tts/tts.module';
import { ThrottlerExceptionFilter } from './throttler-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Rate limiting configuration - very generous limits
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 1000,
      },
      {
        name: 'chat',
        ttl: 60000,
        limit: 50,
      },
      {
        name: 'tts',
        ttl: 60000,
        limit: 50,
      },
      {
        name: 'document',
        ttl: 60000, 
        limit: 1000, 
      },
    ]),
    DocumentModule,
    CollaborationModule,
    ChatModule,
    TtsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ThrottlerExceptionFilter,
    },
  ],
})
export class AppModule {}
