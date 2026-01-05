import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { trace } from '@opentelemetry/api';
import logger from '../logger';

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

@Controller('api/v1/chat')
export class ChatController {
  @Post()
  async chat(@Body() body: RequestBody, @Req() req: Request): Promise<string> {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const model = body.model || 'x-ai/grok-4.1-fast';

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey || apiKey.length === 0) {
      logger.error('POST /api/v1/chat failed', {
        clientId,
        error: 'OPENROUTER_API_KEY not set',
      });
      throw new HttpException(
        { error: 'OPENROUTER_API_KEY environment variable is not set or is empty' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const { OpenRouter } = await import('@openrouter/sdk');

    const openRouter = new OpenRouter({
      apiKey,
    });

    const transformedMessages = transformMessages(body.messages);

    // Log the request with context
    logger.info('POST /api/v1/chat', {
      clientId,
      model,
      provider: body.provider,
      messages: transformedMessages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string' 
          ? msg.content.substring(0, 500) + (msg.content.length > 500 ? '...' : '')
          : '[multipart content]',
      })),
    });

    let response: ChatResponse;
    try {
      response = (await openRouter.chat.send({
        model,
        stream: false,
        provider: body.provider || {
          sort: 'latency',
        },
        messages: transformedMessages,
      })) as ChatResponse;
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide more helpful error messages for common OpenRouter errors
      if (errorMessage.includes('User not found')) {
        errorMessage = 'Invalid or missing OpenRouter API key. Please check your OPENROUTER_API_KEY environment variable.';
      }
      
      logger.error('POST /api/v1/chat failed', {
        clientId,
        model,
        error: errorMessage,
      });
      
      throw new HttpException(
        { error: 'Failed to get chat response', details: errorMessage },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const content = response.choices[0]?.message?.content;
    const result = typeof content === 'string' ? content : '';
    
    // Log the response
    logger.info('POST /api/v1/chat response', {
      clientId,
      model,
      response: result.substring(0, 1000) + (result.length > 1000 ? '...' : ''),
      responseLength: result.length,
    });
    
    return result;
  }

  @Post('stream')
  async streamChat(
    @Body() body: RequestBody,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const tracer = trace.getTracer('chat-stream-tracer');
    const span = tracer.startSpan('api/v1/chat/stream');
    const clientId = req.headers['x-client-id'] as string | undefined;
    
    if (clientId) {
      span.setAttribute('client.id', clientId);
    }
    span.setAttribute('http.method', 'POST');
    span.setAttribute('http.url', '/api/v1/chat/stream');
    
    // Set streaming headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey || apiKey.length === 0) {
      const errorMessage = 'OPENROUTER_API_KEY environment variable is not set or is empty';
      logger.error('Failed to initialize chat stream', {
        clientId,
        error: errorMessage,
      });
      const encoder = new TextEncoder();
      res.write(
        encoder.encode(
          `data: ${JSON.stringify({ error: 'Failed to initialize chat stream', details: errorMessage })}\n\n`,
        ),
      );
      res.end();
      span.setAttribute('http.status_code', 500);
      span.setAttribute('error', true);
      span.setAttribute('error.message', errorMessage);
      span.end();
      return;
    }

    const { OpenRouter } = await import('@openrouter/sdk');

    const openRouter = new OpenRouter({
      apiKey,
    });

    const transformedMessages = transformMessages(body.messages);

    // Log the request with context
    logger.info('POST /api/v1/chat/stream', {
      clientId,
      model: body.model || 'x-ai/grok-4.1-fast',
      provider: body.provider,
      ip: req.ip,
      messages: transformedMessages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string' 
          ? msg.content.substring(0, 500) + (msg.content.length > 500 ? '...' : '')
          : '[multipart content]',
      })),
    });

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
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide more helpful error messages for common OpenRouter errors
      if (errorMessage.includes('User not found')) {
        errorMessage = 'Invalid or missing OpenRouter API key. Please check your OPENROUTER_API_KEY environment variable.';
      }
      
      logger.error('Failed to initialize chat stream', {
        clientId,
        error: errorMessage,
        originalError: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      const encoder = new TextEncoder();
      res.write(
        encoder.encode(
          `data: ${JSON.stringify({ error: 'Failed to initialize chat stream', details: errorMessage })}\n\n`,
        ),
      );
      res.end();
      span.setAttribute('http.status_code', res.statusCode);
      span.setAttribute('error', true);
      span.setAttribute('error.message', errorMessage);
      span.end();
      return;
    }

    const encoder = new TextEncoder();
    let fullResponse = '';

    try {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? '';
        if (content) {
          fullResponse += content;
          res.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
        }
      }
      res.write(encoder.encode('data: [DONE]\n\n'));
      res.end();
      span.setAttribute('http.status_code', res.statusCode);
      span.setAttribute('http.status_text', 'OK');
      span.end();
      
      // Log the response
      logger.info('POST /api/v1/chat/stream response', {
        clientId,
        response: fullResponse.substring(0, 1000) + (fullResponse.length > 1000 ? '...' : ''),
        responseLength: fullResponse.length,
        statusCode: res.statusCode,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Stream error';
      logger.error('Chat stream error', {
        clientId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.write(
        encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`),
      );
      res.end();
      span.setAttribute('http.status_code', res.statusCode);
      span.setAttribute('error', true);
      span.setAttribute('error.message', errorMessage);
      span.end();
    }
  }
}

