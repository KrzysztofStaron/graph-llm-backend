import { Controller, Post, Body, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller()
export class AppController {
  @Post('api/v1/chat')
  async chat(@Body() body: { message: string }): Promise<string> {
    const { OpenRouter } = await import('@openrouter/sdk');

    const openRouter = new OpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const response = await openRouter.chat.send({
      model: 'openai/gpt-oss-120b',
      stream: false,
      provider: {
        sort: 'latency',
      },
      messages: [
        {
          role: 'user',
          content: body.message,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  @Post('api/v1/chat/stream')
  async streamChat(
    @Body() body: { message: string },
    @Res() res: Response,
  ): Promise<void> {
    const { OpenRouter } = await import('@openrouter/sdk');

    const openRouter = new OpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const stream = await openRouter.chat.send({
      model: 'openai/gpt-oss-120b',
      stream: true,
      provider: {
        sort: 'latency',
      },
      messages: [
        {
          role: 'user',
          content: body.message,
        },
      ],
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const encoder = new TextEncoder();

    try {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
        }
      }
      res.write(encoder.encode('data: [DONE]\n\n'));
      res.end();
    } catch {
      res.write(
        encoder.encode(
          `data: ${JSON.stringify({ error: 'Stream error' })}\n\n`,
        ),
      );
      res.end();
    }
  }
}
