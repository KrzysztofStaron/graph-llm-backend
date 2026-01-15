import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import type { Response, Request } from 'express';
import { trace } from '@opentelemetry/api';
import logger from '../logger';
import { captureEvent } from '../posthog.service';

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
  content: string | ContentPartSDK[];
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
  content: string | ContentPartInput[];
};

type SystemMessageInput = {
  role: 'system';
  content: string;
};

type ChatMessageInput =
  | UserMessageInput
  | AssistantMessageInput
  | SystemMessageInput;

type WebSearchPlugin = {
  id: 'web';
  max_results?: number;
  engine?: 'native' | 'exa';
  search_prompt?: string;
};

type RequestBody = {
  messages: ChatMessageInput[];
  model?: string;
  imageModel?: string;
  provider?: {
    sort?: 'latency' | 'price' | 'throughput';
    allow_fallbacks?: boolean;
  };
  plugins?: WebSearchPlugin[];
};

// Response types for SDK
type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type ChatResponseChoice = {
  message?: {
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason?: string;
};

type ChatResponse = {
  choices: ChatResponseChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type ChatStreamChunk = {
  choices: {
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

// Tool definitions for image generation
const IMAGE_GENERATION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'generate_image',
    description:
      'Generate an image based on a text description. Use this when the user asks you to create, draw, visualize, or generate an image, illustration, diagram, or any visual content.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'A detailed description of the image to generate. Be specific about style, colors, composition, and subject matter.',
        },
        style: {
          type: 'string',
          enum: ['natural', 'vivid'],
          description:
            'The style of the generated image. "natural" produces more realistic images, "vivid" produces more dramatic and artistic images.',
        },
      },
      required: ['prompt'],
    },
  },
};

// Tool definition for YouTube video embedding
const YOUTUBE_VIDEO_TOOL = {
  type: 'function' as const,
  function: {
    name: 'show_youtube_video',
    description:
      'Embed a YouTube video in the graph when a video would significantly enhance your response. Use this when the user asks about topics that would benefit from video explanation, tutorial, demonstration, or visual learning. Only call this when a video would truly add value to the conversation.',
    parameters: {
      type: 'object',
      properties: {
        videoId: {
          type: 'string',
          description:
            'The YouTube video ID (the part after "v=" in the URL, e.g., "dQw4w9WgXcQ"). Make sure this is a real, relevant video ID.',
        },
        explanation: {
          type: 'string',
          description:
            'A brief explanation of why this video is relevant and what the user will learn from it.',
        },
      },
      required: ['videoId', 'explanation'],
    },
  },
};

// Image generation function
async function generateImage(
  messages: MessageSDK[],
  prompt: string,
  style: string = 'vivid',
  model: string = 'google/gemini-3-pro-image-preview',
  retryCount: number = 0,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set for image generation');
  }

  // Count how many images are in the context (both user and assistant messages)
  const imageCount = messages.filter((msg) => {
    if (
      (msg.role === 'user' || msg.role === 'assistant') &&
      Array.isArray(msg.content)
    ) {
      return msg.content.some((part) => part.type === 'image_url');
    }
    return false;
  }).length;

  logger.info('Generating image with full context', {
    prompt: prompt.substring(0, 200),
    style,
    retryCount,
    contextMessageCount: messages.length,
    imagesInContext: imageCount,
  });

  // Use OpenRouter chat completion with Gemini 3 Pro Image (image editing model)
  // Pass the full conversation context so it can see previous images and messages
  const imageGenMessages: MessageSDK[] = [
    {
      role: 'system' as const,
      content:
        "You are an image generation and editing AI. Use the images and context from the conversation to generate or edit images based on the user's request. Always return an image.",
    },
    ...messages,
    {
      role: 'user' as const,
      content: prompt,
    },
  ];

  // Log what we're sending to help debug
  const messagesWithImages = imageGenMessages.filter(
    (msg) =>
      (msg.role === 'user' || msg.role === 'assistant') &&
      Array.isArray(msg.content),
  );

  logger.info('Image generation request details', {
    messageCount: imageGenMessages.length,
    lastMessagePreview: imageGenMessages[imageGenMessages.length - 1]?.content
      ?.toString()
      .substring(0, 100),
    multipartMessageCount: messagesWithImages.length,
    messageStructure: imageGenMessages.map((msg) => ({
      role: msg.role,
      contentType:
        typeof msg.content === 'string'
          ? 'string'
          : Array.isArray(msg.content)
            ? `array[${msg.content.length}]`
            : 'unknown',
      hasImages:
        (msg.role === 'user' || msg.role === 'assistant') &&
        Array.isArray(msg.content)
          ? msg.content.some((p) => p.type === 'image_url')
          : false,
    })),
  });

  // Convert messages to API format (snake_case) for direct fetch call
  const apiMessages = convertMessagesToAPIFormat(imageGenMessages);

  // Count images being sent (both user and assistant messages)
  const imagesSent = apiMessages
    .filter(
      (msg) =>
        (msg.role === 'user' || msg.role === 'assistant') &&
        Array.isArray(msg.content),
    )
    .reduce(
      (count, msg) =>
        count + msg.content.filter((p: any) => p.type === 'image_url').length,
      0,
    );

  logger.info('Sending image generation request', {
    messageCount: apiMessages.length,
    imagesSent,
    model,
  });

  // Add timeout to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

  try {
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://graphai.one',
          'X-Title': 'GraphAI',
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          provider: {
            sort: 'latency',
          },
          modalities: ['image', 'text'],
          temperature: 0.9,
        }),
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Image generation failed', {
        status: response.status,
        error: errorText,
      });
      throw new Error(`Image generation failed: ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content?: string;
          images?: Array<{
            type: string;
            image_url: { url: string };
          }>;
        };
      }>;
    };

    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    // Accept both data URLs (base64) and hosted URLs (https://)
    const isValidUrl = imageUrl && (imageUrl.startsWith('data:image/') || imageUrl.startsWith('http://') || imageUrl.startsWith('https://'));

    if (!isValidUrl) {
      logger.error('Invalid image generation response structure', {
        responsePreview: JSON.stringify(data).substring(0, 1000),
        hasChoices: !!data.choices,
        hasMessage: !!data.choices?.[0]?.message,
        hasImages: !!data.choices?.[0]?.message?.images,
        messageContent: data.choices?.[0]?.message?.content?.substring(0, 200),
        messageKeys: data.choices?.[0]?.message
          ? Object.keys(data.choices[0].message)
          : [],
        retryCount,
        receivedImageUrl: imageUrl?.substring(0, 100),
        receivedImageUrlLength: imageUrl?.length,
      });

      // Retry up to 2 times if no image is returned
      if (retryCount < 2) {
        logger.warn('No valid image URL returned, retrying...', {
          retryCount: retryCount + 1,
          receivedUrl: imageUrl?.substring(0, 100),
        });
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retry
        return generateImage(messages, prompt, style, model, retryCount + 1);
      }

      throw new Error(
        `No valid image URL returned after ${retryCount + 1} attempts. Got: ${imageUrl?.substring(0, 100)}`,
      );
    }

    // Log whether it's a data URL or hosted URL
    const isDataUrl = imageUrl.startsWith('data:');
    const urlType = isDataUrl ? 'base64 data URL' : 'hosted URL';
    const urlLength = isDataUrl ? Math.round(imageUrl.length / 1024) : imageUrl.length;
    const urlSizeUnit = isDataUrl ? 'KB' : 'chars';
    const warningLevel = isDataUrl ? 'warn' : 'info';
    const message = isDataUrl 
      ? `Image generated but as base64 data URL (${urlLength}KB) - prefer hosted URLs`
      : `Image generated as hosted URL (${urlLength} chars)`;

    // Comprehensive single log call
    if (warningLevel === 'warn') {
      logger.warn(`[IMAGE_GENERATION] [WARN] ${message}`, {
        urlType,
        urlLength: `${urlLength}${urlSizeUnit}`,
        urlPrefix: imageUrl.substring(0, 100),
        retryCount,
        model,
      });
    } else {
      logger.info(`[IMAGE_GENERATION] [OK] ${message}`, {
        urlType,
        urlLength: `${urlLength}${urlSizeUnit}`,
        urlPrefix: imageUrl.substring(0, 50),
        retryCount,
        model,
      });
    }
    return imageUrl;
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      logger.error('Image generation timed out', {
        retryCount,
        promptLength: prompt.length,
      });
      throw new Error(
        'Image generation timed out after 60 seconds. The request may be too complex or the model may be overloaded.',
      );
    }

    throw error;
  }
}

// Transform frontend message format to SDK format (snake_case image_url -> camelCase imageUrl)
function transformMessages(messages: ChatMessageInput[]): MessageSDK[] {
  return messages.map((msg): MessageSDK => {
    if (msg.role === 'user' || msg.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string') {
        return { ...msg, content } as MessageSDK;
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
      return { ...msg, content: transformedContent } as MessageSDK;
    }
    return msg;
  });
}

// Convert SDK format back to API format (camelCase imageUrl -> snake_case image_url)
// Used when sending directly to OpenRouter API via fetch (not via SDK)
function convertMessagesToAPIFormat(messages: MessageSDK[]): any[] {
  return messages.map((msg) => {
    if (
      (msg.role === 'user' || msg.role === 'assistant') &&
      Array.isArray(msg.content)
    ) {
      const apiContent = msg.content.map((part) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        // Convert imageUrl (camelCase) back to image_url (snake_case)
        return {
          type: 'image_url',
          image_url: {
            url: part.imageUrl.url,
            detail: part.imageUrl.detail,
          },
        };
      });
      return { ...msg, content: apiContent };
    }
    return msg;
  });
}

@Controller('api/v1/chat')
export class ChatController {
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  async chat(@Body() body: RequestBody, @Req() req: Request): Promise<string> {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const model = body.model || 'x-ai/grok-4.1-fast';

    const logData: {
      clientId?: string;
      model?: string;
      provider?: unknown;
      messages?: unknown[];
      error?: string;
      responseLength?: number;
      responsePreview?: string;
      safetyFilterTriggered?: boolean;
    } = {
      clientId,
      model,
      provider: body.provider,
    };

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey || apiKey.length === 0) {
      logData.error = 'OPENROUTER_API_KEY not set';
      logger.error('POST /api/v1/chat failed', logData);
      throw new HttpException(
        {
          error:
            'OPENROUTER_API_KEY environment variable is not set or is empty',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const { OpenRouter } = await import('@openrouter/sdk');

    const openRouter = new OpenRouter({
      apiKey,
    });

    const transformedMessages = transformMessages(body.messages);
    logData.messages = transformedMessages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content.substring(0, 500) +
              (msg.content.length > 500 ? '...' : '')
            : '[multipart content]',
      }));

    let response: ChatResponse;
    try {
      response = (await openRouter.chat.send({
        model,
        stream: false,
        provider: body.provider || {
          sort: 'latency',
        },
        messages: transformedMessages,
        ...(body.plugins && { plugins: body.plugins }),
      })) as ChatResponse;
    } catch (error) {
      let errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Provide more helpful error messages for common OpenRouter errors
      if (errorMessage.includes('User not found')) {
        errorMessage =
          'Invalid or missing OpenRouter API key. Please check your OPENROUTER_API_KEY environment variable.';
      } else if (errorMessage.includes('SAFETY_CHECK_TYPE_DATA_LEAKAGE')) {
        errorMessage =
          "Content was flagged by the AI provider's safety filter. This has been logged and should be resolved with a retry.";
        logData.safetyFilterTriggered = true;
      }

      logData.error = errorMessage;
      logger.error('POST /api/v1/chat failed', logData);

      // Track message sent event with error
      captureEvent(
        clientId || 'anonymous',
        'message_sent',
        {
          model,
          provider: body.provider,
          messageCount: transformedMessages.length,
          hasWebSearch: !!body.plugins?.some((p) => p.id === 'web'),
          success: false,
          error: errorMessage,
          safetyFilterTriggered: logData.safetyFilterTriggered,
        },
      );

      throw new HttpException(
        { error: 'Failed to get chat response', details: errorMessage },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const content = response.choices[0]?.message?.content;
    const result = typeof content === 'string' ? content : '';

    logData.responseLength = result.length;
    logData.responsePreview = result.substring(0, 1000) + (result.length > 1000 ? '...' : '');
    logger.info('POST /api/v1/chat', logData);

      // Track message sent event
      captureEvent(
        clientId || 'anonymous',
        'message_sent',
        {
          model,
          provider: body.provider,
          messageCount: transformedMessages.length,
          responseLength: result.length,
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
          totalTokens: response.usage?.total_tokens,
          hasWebSearch: !!body.plugins?.some((p) => p.id === 'web'),
          success: true,
        },
      );

    return result;
  }

  @Post('stream')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  async streamChat(
    @Body() body: RequestBody,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const tracer = trace.getTracer('chat-stream-tracer');
    const span = tracer.startSpan('api/v1/chat/stream');
    const clientId = req.headers['x-client-id'] as string | undefined;

    const logData: {
      clientId?: string;
      model?: string;
      provider?: unknown;
      ip?: string;
      messages?: unknown[];
      error?: string;
      originalError?: string;
      stack?: string;
      safetyFilterTriggered?: boolean;
      responseLength?: number;
      responsePreview?: string;
      reasoningLength?: number;
      chunkCount?: number;
      finishReason?: string | null;
      toolCallCount?: number;
      statusCode?: number;
      noContent?: boolean;
      imageGenerationError?: string;
      youtubeError?: string;
      streamStatus?: string;
      streamMessage?: string;
    } = {
      clientId,
      model: body.model || 'x-ai/grok-4.1-fast',
      provider: body.provider,
      ip: req.ip,
    };

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
      const errorMessage =
        'OPENROUTER_API_KEY environment variable is not set or is empty';
      logData.error = errorMessage;
      logger.error('Failed to initialize chat stream', logData);
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
    logData.messages = transformedMessages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content.substring(0, 500) +
              (msg.content.length > 500 ? '...' : '')
            : '[multipart content]',
      }));

    let stream: AsyncIterable<ChatStreamChunk>;
    try {
      stream = (await openRouter.chat.send({
        model: body.model || 'x-ai/grok-4.1-fast',
        stream: true,
        provider: body.provider || {
          sort: 'latency',
        },
        messages: transformedMessages,
        tools: [IMAGE_GENERATION_TOOL, YOUTUBE_VIDEO_TOOL],
        toolChoice: 'auto',
        ...(body.plugins && { plugins: body.plugins }),
      })) as AsyncIterable<ChatStreamChunk>;
    } catch (error) {
      let errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Provide more helpful error messages for common OpenRouter errors
      if (errorMessage.includes('User not found')) {
        errorMessage =
          'Invalid or missing OpenRouter API key. Please check your OPENROUTER_API_KEY environment variable.';
      } else if (errorMessage.includes('SAFETY_CHECK_TYPE_DATA_LEAKAGE')) {
        errorMessage =
          "Content was flagged by the AI provider's safety filter. This has been logged and will be retried with a different format.";
        logData.safetyFilterTriggered = true;
      }

      logData.error = errorMessage;
      logData.originalError = error instanceof Error ? error.message : String(error);
      logData.stack = error instanceof Error ? error.stack : undefined;
      logger.error('Failed to initialize chat stream', logData);
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
    let fullReasoning = '';
    let chunkCount = 0;
    let usageData: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    } | null = null;

    // Track tool calls being assembled from streaming chunks
    const toolCallsInProgress: Map<
      number,
      { id: string; name: string; arguments: string }
    > = new Map();
    let finishReason: string | null = null;

    try {
      for await (const chunk of stream) {
        chunkCount++;

        // Capture usage data if available
        if (chunk.usage) {
          usageData = chunk.usage;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Track finish reason
        if (choice.finish_reason || (choice as any).finishReason) {
          finishReason = choice.finish_reason || (choice as any).finishReason;
        }

        // Handle reasoning content (from models like o1)
        const reasoning =
          delta?.reasoning ?? (delta as any)?.reasoning_content ?? '';
        if (reasoning) {
          fullReasoning += reasoning;
          res.write(
            encoder.encode(`data: ${JSON.stringify({ reasoning })}\n\n`),
          );
        }

        // Handle regular text content
        const content = delta?.content ?? '';
        if (content) {
          fullResponse += content;
          res.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
        }

        // Handle tool calls (assembled from streaming chunks)
        // Check both delta.tool_calls (OpenAI) and delta.toolCalls (camelCase fallback)
        const toolCalls =
          delta?.tool_calls ||
          (delta as any)?.toolCalls ||
          (choice as any).tool_calls ||
          (choice as any).toolCalls;

        if (toolCalls && Array.isArray(toolCalls)) {
          for (const toolCallDelta of toolCalls) {
            const index = toolCallDelta.index ?? 0;

            if (!toolCallsInProgress.has(index)) {
              toolCallsInProgress.set(index, {
                id: toolCallDelta.id || '',
                name: toolCallDelta.function?.name || '',
                arguments: '',
              });
            }

            const toolCall = toolCallsInProgress.get(index)!;
            if (toolCallDelta.id) toolCall.id = toolCallDelta.id;

            const func = toolCallDelta.function || toolCallDelta.function;
            if (func?.name) toolCall.name = func.name;
            if (func?.arguments) toolCall.arguments += func.arguments;
          }
        }
      }

      // Process tool calls if any were found, regardless of finishReason
      if (toolCallsInProgress.size > 0) {
        for (const [index, toolCall] of toolCallsInProgress) {
          // If the model called the image generation tool
          if (toolCall.name === 'generate_image') {
            try {
              const args = JSON.parse(toolCall.arguments) as {
                prompt: string;
                style?: string;
              };
              const imageModel =
                body.imageModel || 'google/gemini-3-pro-image-preview';
              const imageUrl = await generateImage(
                transformedMessages,
                args.prompt,
                args.style,
                imageModel,
              );

              // Send image response in special format
              res.write(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'image',
                    content: imageUrl,
                    prompt: args.prompt,
                  })}\n\n`,
                ),
              );

              fullResponse += `[IMAGE:${imageUrl}]`;
            } catch (imageError) {
              const errorMsg =
                imageError instanceof Error
                  ? imageError.message
                  : 'Image generation failed';
              logData.imageGenerationError = errorMsg;
              res.write(
                encoder.encode(
                  `data: ${JSON.stringify({
                    error: `Failed to generate image: ${errorMsg}`,
                  })}\n\n`,
                ),
              );
            }
          }

          // If the model called the YouTube video tool
          if (toolCall.name === 'show_youtube_video') {
            try {
              const args = JSON.parse(toolCall.arguments) as {
                videoId: string;
                explanation?: string;
              };

              // Send YouTube video response in special format (can be multiple)
              res.write(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'youtube',
                    videoId: args.videoId,
                    explanation: args.explanation || '',
                  })}\n\n`,
                ),
              );

              fullResponse += `[YOUTUBE:${args.videoId}]`;
            } catch (youtubeError) {
              const errorMsg =
                youtubeError instanceof Error
                  ? youtubeError.message
                  : 'YouTube video embedding failed';
              logData.youtubeError = errorMsg;
              res.write(
                encoder.encode(
                  `data: ${JSON.stringify({
                    error: `Failed to embed YouTube video: ${errorMsg}`,
                  })}\n\n`,
                ),
              );
            }
          }
        }
      }

      logData.responseLength = fullResponse.length;
      logData.responsePreview = fullResponse.substring(0, 1000) + (fullResponse.length > 1000 ? '...' : '');
      logData.reasoningLength = fullReasoning.length;
      logData.chunkCount = chunkCount;
      logData.finishReason = finishReason;
      logData.toolCallCount = toolCallsInProgress.size;
      logData.statusCode = res.statusCode;

      // Determine stream status
      let streamStatus = 'OK';
      let streamStatusMessage = 'Stream completed successfully';
      if (
        fullResponse.length === 0 &&
        fullReasoning.length === 0 &&
        toolCallsInProgress.size === 0
      ) {
        logData.noContent = true;
        streamStatus = 'WARN';
        streamStatusMessage = 'Stream completed but no content generated';
      } else if (toolCallsInProgress.size > 0) {
        streamStatus = 'OK_WITH_TOOLS';
        streamStatusMessage = `Stream completed with ${toolCallsInProgress.size} tool call(s)`;
      }

      res.write(encoder.encode('data: [DONE]\n\n'));
      res.end();
      span.setAttribute('http.status_code', res.statusCode);
      span.setAttribute('http.status_text', 'OK');
      span.end();

      // Consolidated stream completion log
      logData.streamStatus = streamStatus;
      logData.streamMessage = streamStatusMessage;
      logger.info(`[STREAM_COMPLETION] [${streamStatus}] ${streamStatusMessage}`, logData);

      // Track message sent event
      captureEvent(
        clientId || 'anonymous',
        'message_sent',
        {
          model: body.model || 'x-ai/grok-4.1-fast',
          provider: body.provider,
          messageCount: transformedMessages.length,
          responseLength: fullResponse.length,
          reasoningLength: fullReasoning.length,
          chunkCount,
          finishReason,
          toolCallCount: toolCallsInProgress.size,
          inputTokens: usageData?.prompt_tokens,
          outputTokens: usageData?.completion_tokens,
          totalTokens: usageData?.total_tokens,
          hasWebSearch: !!body.plugins?.some((p) => p.id === 'web'),
          hasImageGeneration: toolCallsInProgress.size > 0 && Array.from(toolCallsInProgress.values()).some((tc) => tc.name === 'generate_image'),
          hasYoutubeEmbed: toolCallsInProgress.size > 0 && Array.from(toolCallsInProgress.values()).some((tc) => tc.name === 'show_youtube_video'),
          success: true,
        },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Stream error';
      logData.error = errorMessage;
      logData.stack = error instanceof Error ? error.stack : undefined;
      logData.chunkCount = chunkCount;
      logger.error('Chat stream error', logData);

      // Track message sent event with error
      captureEvent(
        clientId || 'anonymous',
        'message_sent',
        {
          model: body.model || 'x-ai/grok-4.1-fast',
          provider: body.provider,
          messageCount: transformedMessages.length,
          responseLength: fullResponse.length,
          reasoningLength: fullReasoning.length,
          chunkCount,
          inputTokens: usageData?.prompt_tokens,
          outputTokens: usageData?.completion_tokens,
          totalTokens: usageData?.total_tokens,
          hasWebSearch: !!body.plugins?.some((p) => p.id === 'web'),
          success: false,
          error: errorMessage,
        },
      );

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
