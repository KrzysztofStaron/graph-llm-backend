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
import { trace } from '@opentelemetry/api';
import logger from './logger';

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
    return `
      Graph LLM Backend V.5

      Available endpoints:
      GET      /
      POST     /api/v1/chat
      OPTIONS  /api/v1/chat/stream
      POST     /api/v1/chat/stream
    `.trim();
  }

  @Post('api/v1/chat')
  async chat(@Body() body: RequestBody, @Req() req: Request): Promise<string> {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const model = body.model || 'x-ai/grok-4.1-fast';
    
    logger.info('POST /api/v1/chat', {
      clientId,
      model,
      messageCount: body.messages?.length || 0,
      provider: body.provider,
    });

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

    // Log the context being sent
    logger.info('Chat context', {
      clientId,
      model,
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
    logger.info('Chat response', {
      clientId,
      model,
      response: result.substring(0, 1000) + (result.length > 1000 ? '...' : ''),
      responseLength: result.length,
    });
    
    return result;
  }

  @Options('api/v1/chat/stream')
  streamChatOptions(@Req() req: Request, @Res() res: Response): void {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-Client-Id',
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
    const tracer = trace.getTracer('chat-stream-tracer');
    const span = tracer.startSpan('api/v1/chat/stream');
    const clientId = req.headers['x-client-id'] as string | undefined;
    
    if (clientId) {
      span.setAttribute('client.id', clientId);
    }
    span.setAttribute('http.method', 'POST');
    span.setAttribute('http.url', '/api/v1/chat/stream');
    
    logger.info('Chat stream request received', {
      clientId,
      model: body.model,
      messageCount: body.messages?.length || 0,
      ip: req.ip,
    });
    
    // Set CORS headers first
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-Client-Id',
    );
    res.setHeader('Access-Control-Expose-Headers', '*');
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

    // Log the context being sent
    logger.info('Chat stream context', {
      clientId,
      model: body.model || 'x-ai/grok-4.1-fast',
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
      
      // Log the full response
      logger.info('Chat stream response', {
        clientId,
        response: fullResponse.substring(0, 1000) + (fullResponse.length > 1000 ? '...' : ''),
        responseLength: fullResponse.length,
      });
      
      logger.info('Chat stream completed successfully', {
        clientId,
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

  @Options('api/v1/text-to-speech')
  textToSpeechOptions(@Req() req: Request, @Res() res: Response): void {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-Client-Id',
    );
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
  }

  @Post('api/v1/text-to-speech')
  async textToSpeech(
    @Body() body: { text: string; includeTimestamps?: boolean },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const { text, includeTimestamps = false } = body;
    
    logger.info('POST /api/v1/text-to-speech', {
      clientId,
      textLength: text?.length || 0,
      includeTimestamps,
    });

    // Set CORS headers first
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-Client-Id',
    );
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (!text || typeof text !== 'string') {
      logger.warn('POST /api/v1/text-to-speech failed', {
        clientId,
        error: 'Text is required',
      });
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'Text is required' });
      return;
    }

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      logger.error('POST /api/v1/text-to-speech failed', {
        clientId,
        error: 'DEEPGRAM_API_KEY not configured',
      });
      res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'DEEPGRAM_API_KEY is not configured' });
      return;
    }

    try {
      // Call Deepgram TTS API directly
      const deepgramResponse = await fetch(
        'https://api.deepgram.com/v1/speak?model=aura-2-odysseus-en',
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        },
      );

      if (!deepgramResponse.ok) {
        const errorText = await deepgramResponse.text();
        logger.error('POST /api/v1/text-to-speech failed', {
          clientId,
          error: 'Deepgram API error',
          status: deepgramResponse.status,
        });
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          error: 'Failed to generate speech',
          details: `Deepgram API error: ${deepgramResponse.status} ${errorText}`,
        });
        return;
      }

      if (includeTimestamps) {
        // For timestamps, we need to transcribe the audio
        // Collect audio first, then transcribe it
        const audioBuffer = await deepgramResponse.arrayBuffer();
        const audioBlob = Buffer.from(audioBuffer);

        // Deepgram STT accepts raw binary audio data directly
        // Send as raw binary with proper content-type header
        const transcriptionResponse = await fetch(
          'https://api.deepgram.com/v1/listen?model=nova-2&utterances=true&punctuate=true',
          {
            method: 'POST',
            headers: {
              Authorization: `Token ${apiKey}`,
              'Content-Type': 'audio/mpeg',
            },
            body: audioBlob,
          },
        );

        if (!transcriptionResponse.ok) {
          // If transcription fails, still return audio without timestamps
          logger.warn('POST /api/v1/text-to-speech transcription failed, returning audio only', {
            clientId,
            audioGenerated: true,
            audioSize: audioBlob.length,
          });
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Cache-Control', 'no-cache');
          res.send(audioBlob);
          return;
        }

        const transcriptionDataRaw =
          (await transcriptionResponse.json()) as unknown;
        const transcriptionData = transcriptionDataRaw as {
          results?: {
            channels?: Array<{
              alternatives?: Array<{
                words?: Array<{
                  word?: string;
                  start?: number;
                  end?: number;
                  confidence?: number;
                }>;
              }>;
            }>;
            utterances?: Array<{
              words?: Array<{
                word?: string;
                start?: number;
                end?: number;
              }>;
            }>;
          };
        };

        const words: Array<{
          word: string;
          start: number;
          end: number;
        }> = [];

        // Extract word-level timestamps from transcription
        // According to Deepgram docs: words are in results.channels[0].alternatives[0].words[]
        if (transcriptionData?.results?.channels) {
          for (const channel of transcriptionData.results.channels) {
            if (channel.alternatives && Array.isArray(channel.alternatives)) {
              for (const alternative of channel.alternatives) {
                if (alternative.words && Array.isArray(alternative.words)) {
                  for (const word of alternative.words) {
                    if (
                      word.word &&
                      word.start !== undefined &&
                      word.end !== undefined
                    ) {
                      words.push({
                        word: word.word,
                        start: word.start,
                        end: word.end,
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // Also check utterances if available (some responses might use this structure)
        if (words.length === 0 && transcriptionData?.results?.utterances) {
          for (const utterance of transcriptionData.results.utterances) {
            if (utterance.words && Array.isArray(utterance.words)) {
              for (const word of utterance.words) {
                if (
                  word.word &&
                  word.start !== undefined &&
                  word.end !== undefined
                ) {
                  words.push({
                    word: word.word,
                    start: word.start,
                    end: word.end,
                  });
                }
              }
            }
          }
        }

        // Return JSON with audio as base64 and timestamps
        res.setHeader('Content-Type', 'application/json');
        res.json({
          audio: audioBlob.toString('base64'),
          words,
          duration: words.length > 0 ? words[words.length - 1].end : 0,
        });
        
        logger.info('POST /api/v1/text-to-speech completed', {
          clientId,
          audioGenerated: true,
          audioSize: audioBlob.length,
          wordCount: words.length,
          includeTimestamps: true,
        });
        return;
      }

      // Set appropriate headers for audio streaming (no timestamps)
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Stream the response body directly to client
      if (!deepgramResponse.body) {
        throw new Error('Response body is null');
      }

      const reader = deepgramResponse.body.getReader();

      let bytesStreamed = 0;
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            logger.info('POST /api/v1/text-to-speech completed', {
              clientId,
              audioGenerated: true,
              bytesStreamed,
              includeTimestamps: false,
            });
            break;
          }
          bytesStreamed += value.length;
          res.write(Buffer.from(value));
        }
      };

      pump().catch((error) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('POST /api/v1/text-to-speech stream error', {
          clientId,
          error: errorMessage,
        });
        if (!res.headersSent) {
          res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            error: 'Failed to stream audio',
            details: errorMessage,
          });
        } else {
          res.end();
        }
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('POST /api/v1/text-to-speech failed', {
        clientId,
        error: errorMessage,
      });
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to generate speech',
        details: errorMessage,
      });
    }
  }
}
