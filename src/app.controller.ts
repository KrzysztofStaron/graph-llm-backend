import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  Get,
  Options,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';

// SDK-compatible types (using camelCase for imageUrl as SDK expects)
type TextContentPartSDK = { type: 'text'; text: string };
type ImageContentPartSDK = {
  type: 'image_url';
  imageUrl: { url: string; detail?: 'auto' | 'low' | 'high' };
};
type ContentPartSDK = TextContentPartSDK | ImageContentPartSDK;

type UserMessageSDK = {
  role: 'user';
  content: string | ContentPartSDK[];
};

type AssistantMessageSDK = {
  role: 'assistant';
  content: string;
};

type SystemMessageSDK = {
  role: 'system';
  content: string;
};

type MessageSDK = UserMessageSDK | AssistantMessageSDK | SystemMessageSDK;

// Input types (from frontend, using snake_case for image_url per OpenAI spec)
type TextContentPartInput = { type: 'text'; text: string };
type ImageContentPartInput = {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
};
type ContentPartInput = TextContentPartInput | ImageContentPartInput;

type UserMessageInput = {
  role: 'user';
  content: string | ContentPartInput[];
};

type AssistantMessageInput = {
  role: 'assistant';
  content: string;
};

type SystemMessageInput = {
  role: 'system';
  content: string;
};

type ChatMessageInput =
  | UserMessageInput
  | AssistantMessageInput
  | SystemMessageInput;

type RequestBody = {
  messages: ChatMessageInput[];
  model?: string;
  provider?: {
    sort?: 'latency' | 'price' | 'throughput';
    allow_fallbacks?: boolean;
  };
};

// Response types for SDK
type ChatResponseChoice = {
  message?: {
    content?: string | null;
  };
};

type ChatResponse = {
  choices: ChatResponseChoice[];
};

type ChatStreamChunk = {
  choices: {
    delta?: {
      content?: string | null;
    };
  }[];
};

// Transform frontend message format to SDK format (snake_case image_url -> camelCase imageUrl)
function transformMessages(messages: ChatMessageInput[]): MessageSDK[] {
  return messages.map((msg): MessageSDK => {
    if (msg.role === 'user') {
      const content = msg.content;
      if (typeof content === 'string') {
        return { role: 'user', content };
      }
      // Transform content parts
      const transformedContent: ContentPartSDK[] = content.map((part) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        // Transform image_url (snake_case) to imageUrl (camelCase)
        return {
          type: 'image_url',
          imageUrl: {
            url: part.image_url.url,
            detail: part.image_url.detail,
          },
        };
      });
      return { role: 'user', content: transformedContent };
    }
    return msg;
  });
}

@Controller()
export class AppController {
  @Get()
  root(): string {
    return 'Graph LLM Backend V.5';
  }

  @Post('api/v1/chat')
  async chat(@Body() body: RequestBody): Promise<string> {
    const { OpenRouter } = await import('@openrouter/sdk');

    const openRouter = new OpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const transformedMessages = transformMessages(body.messages);

    let response: ChatResponse;
    try {
      response = (await openRouter.chat.send({
        model: body.model || 'x-ai/grok-4.1-fast',
        stream: false,
        provider: body.provider || {
          sort: 'latency',
        },
        messages: transformedMessages,
      })) as ChatResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(
        { error: 'Failed to get chat response', details: errorMessage },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const content = response.choices[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  @Options('api/v1/chat/stream')
  streamChatOptions(@Req() req: Request, @Res() res: Response): void {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With',
    );
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
  }

  @Post('api/v1/chat/stream')
  async streamChat(
    @Body() body: RequestBody,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Set CORS headers first
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With',
    );
    res.setHeader('Access-Control-Expose-Headers', '*');
    // Set streaming headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { OpenRouter } = await import('@openrouter/sdk');

    const openRouter = new OpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const transformedMessages = transformMessages(body.messages);

    let stream: AsyncIterable<ChatStreamChunk>;
    try {
      stream = (await openRouter.chat.send({
        model: body.model || 'x-ai/grok-4.1-fast',
        stream: true,
        provider: body.provider || {
          sort: 'latency',
        },
        messages: transformedMessages,
      })) as AsyncIterable<ChatStreamChunk>;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const encoder = new TextEncoder();
      res.write(
        encoder.encode(
          `data: ${JSON.stringify({ error: 'Failed to initialize chat stream', details: errorMessage })}\n\n`,
        ),
      );
      res.end();
      return;
    }

    const encoder = new TextEncoder();

    try {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? '';
        if (content) {
          res.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
        }
      }
      res.write(encoder.encode('data: [DONE]\n\n'));
      res.end();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Stream error';
      res.write(
        encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`),
      );
      res.end();
    }
  }
}
