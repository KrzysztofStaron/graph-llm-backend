import { Controller, Post, Body, Res, Get } from '@nestjs/common';
import type { Response } from 'express';

@Controller()
export class AppController {
  @Get()
  root(): string {
    return 'Graph LLM Backend V.3';
  }

  @Post('api/v1/chat')
  async chat(
    @Body()
    body: {
      messages: { role: string; content: string }[];
      model?: string;
      provider?: {
        sort?: 'latency' | 'price' | 'throughput';
        allow_fallbacks?: boolean;
      };
    },
  ): Promise<string> {
    const { OpenRouter } = await import('@openrouter/sdk');

    const openRouter = new OpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const response = await openRouter.chat.send({
      model: body.model || 'x-ai/grok-4.1-fast',
      stream: false,
      provider: body.provider || {
        sort: 'latency',
      },
      messages: body.messages.map((message) => ({
        role: message.role as 'user' | 'assistant' | 'system',
        content: message.content,
      })),
    });

    const content = response.choices[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  @Post('api/v1/chat/stream')
  async streamChat(
    @Body()
    body: {
      messages: { role: string; content: string }[];
      model?: string;
      provider?: {
        sort?: 'latency' | 'price' | 'throughput';
        allow_fallbacks?: boolean;
      };
    },
    @Res() res: Response,
  ): Promise<void> {
    const { OpenRouter } = await import('@openrouter/sdk');

    const openRouter = new OpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const stream = await openRouter.chat.send({
      model: body.model || 'x-ai/grok-4.1-fast',
      stream: true,
      provider: body.provider || {
        sort: 'latency',
      },
      messages: body.messages.map((message) => ({
        role: message.role as 'user' | 'assistant' | 'system',
        content: message.content,
      })),
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
