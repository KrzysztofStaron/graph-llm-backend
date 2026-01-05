import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  root(): string {
    return `
      Graph LLM Backend V.5

      Available endpoints:
      GET      /
      POST     /api/v1/chat
      OPTIONS  /api/v1/chat/stream
      POST     /api/v1/chat/stream
      OPTIONS  /api/v1/text-to-speech
      POST     /api/v1/text-to-speech
    `.trim();
  }
}
