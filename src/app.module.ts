import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DocumentModule } from './document/document.module';
import { CollaborationModule } from './collaboration/collaboration.module';
import { ChatModule } from './chat/chat.module';
import { TtsModule } from './tts/tts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DocumentModule,
    CollaborationModule,
    ChatModule,
    TtsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
