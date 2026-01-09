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
};

// Tool definitions for image generation
const IMAGE_GENERATION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'generate_image',
    description: 'Generate an image based on a text description. Use this when the user asks you to create, draw, visualize, or generate an image, illustration, diagram, or any visual content.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'A detailed description of the image to generate. Be specific about style, colors, composition, and subject matter.',
        },
        style: {
          type: 'string',
          enum: ['natural', 'vivid'],
          description: 'The style of the generated image. "natural" produces more realistic images, "vivid" produces more dramatic and artistic images.',
        },
      },
      required: ['prompt'],
    },
  },
};

// Image generation function
async function generateImage(messages: MessageSDK[], prompt: string, style: string = 'vivid', model: string = 'google/gemini-3-pro-image-preview', retryCount: number = 0): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set for image generation');
  }

  // Count how many images are in the context (both user and assistant messages)
  const imageCount = messages.filter(msg => {
    if ((msg.role === 'user' || msg.role === 'assistant') && Array.isArray(msg.content)) {
      return msg.content.some(part => part.type === 'image_url');
    }
    return false;
  }).length;

  logger.info('Generating image with full context', { 
    prompt: prompt.substring(0, 200), 
    style, 
    retryCount,
    contextMessageCount: messages.length,
    imagesInContext: imageCount
  });

  // Use OpenRouter chat completion with Gemini 3 Pro Image (image editing model)
  // Pass the full conversation context so it can see previous images and messages
  const imageGenMessages: MessageSDK[] = [
    {
      role: 'system' as const,
      content: 'You are an image generation and editing AI. Use the images and context from the conversation to generate or edit images based on the user\'s request. Always return an image.',
    },
    ...messages,
    {
      role: 'user' as const,
      content: prompt,
    },
  ];

  // Log what we're sending to help debug
  const messagesWithImages = imageGenMessages.filter(msg => 
    (msg.role === 'user' || msg.role === 'assistant') && Array.isArray(msg.content)
  );
  
  logger.info('Image generation request details', {
    messageCount: imageGenMessages.length,
    lastMessagePreview: imageGenMessages[imageGenMessages.length - 1]?.content?.toString().substring(0, 100),
    multipartMessageCount: messagesWithImages.length,
    messageStructure: imageGenMessages.map(msg => ({
      role: msg.role,
      contentType: typeof msg.content === 'string' ? 'string' : Array.isArray(msg.content) ? `array[${msg.content.length}]` : 'unknown',
      hasImages: (msg.role === 'user' || msg.role === 'assistant') && Array.isArray(msg.content) 
        ? msg.content.some(p => p.type === 'image_url')
        : false,
    })),
  });

  // Convert messages to API format (snake_case) for direct fetch call
  const apiMessages = convertMessagesToAPIFormat(imageGenMessages);

  // Count images being sent (both user and assistant messages)
  const imagesSent = apiMessages.filter(msg => 
    (msg.role === 'user' || msg.role === 'assistant') && Array.isArray(msg.content)
  ).reduce((count, msg) => 
    count + msg.content.filter((p: any) => p.type === 'image_url').length, 0
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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
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
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Image generation failed', { status: response.status, error: errorText });
      throw new Error(`Image generation failed: ${errorText}`);
    }

    const data = await response.json() as { 
      choices: Array<{ 
        message: { 
          content?: string;
          images?: Array<{
            type: string;
            image_url: { url: string };
          }>;
        } 
      }> 
    };
    
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    
    if (!imageUrl || !imageUrl.startsWith('data:image/')) {
      logger.error('Invalid image generation response structure', {
        responsePreview: JSON.stringify(data).substring(0, 1000),
        hasChoices: !!data.choices,
        hasMessage: !!data.choices?.[0]?.message,
        hasImages: !!data.choices?.[0]?.message?.images,
        messageContent: data.choices?.[0]?.message?.content?.substring(0, 200),
        messageKeys: data.choices?.[0]?.message ? Object.keys(data.choices[0].message) : [],
        retryCount,
      });
      
      // Retry up to 2 times if no image is returned
      if (retryCount < 2) {
        logger.warn('No image returned, retrying...', { retryCount: retryCount + 1 });
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        return generateImage(messages, prompt, style, model, retryCount + 1);
      }
      
      throw new Error(`No valid image URL returned after ${retryCount + 1} attempts. Got: ${imageUrl?.substring(0, 100)}`);
    }

    logger.info('Image generated successfully', { urlPrefix: imageUrl.substring(0, 50), retryCount });
    return imageUrl;
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      logger.error('Image generation timed out', { retryCount, promptLength: prompt.length });
      throw new Error('Image generation timed out after 60 seconds. The request may be too complex or the model may be overloaded.');
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
    if ((msg.role === 'user' || msg.role === 'assistant') && Array.isArray(msg.content)) {
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
      messages: transformedMessages.filter((msg) => msg.role !== 'system').map((msg) => ({
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
        ...(body.plugins && { plugins: body.plugins }),
      })) as ChatResponse;
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide more helpful error messages for common OpenRouter errors
      if (errorMessage.includes('User not found')) {
        errorMessage = 'Invalid or missing OpenRouter API key. Please check your OPENROUTER_API_KEY environment variable.';
      } else if (errorMessage.includes('SAFETY_CHECK_TYPE_DATA_LEAKAGE')) {
        errorMessage = 'Content was flagged by the AI provider\'s safety filter. This has been logged and should be resolved with a retry.';
        logger.warn('Safety filter triggered (data leakage)', {
          clientId,
          model,
          fullError: errorMessage,
        });
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
      messages: transformedMessages.filter((msg) => msg.role !== 'system').map((msg) => ({
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
        tools: [IMAGE_GENERATION_TOOL],
        toolChoice: 'auto',
        ...(body.plugins && { plugins: body.plugins }),
      })) as AsyncIterable<ChatStreamChunk>;
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide more helpful error messages for common OpenRouter errors
      if (errorMessage.includes('User not found')) {
        errorMessage = 'Invalid or missing OpenRouter API key. Please check your OPENROUTER_API_KEY environment variable.';
      } else if (errorMessage.includes('SAFETY_CHECK_TYPE_DATA_LEAKAGE')) {
        errorMessage = 'Content was flagged by the AI provider\'s safety filter. This has been logged and will be retried with a different format.';
        logger.warn('Safety filter triggered (data leakage) - stream initialization', {
          clientId,
          model: body.model || 'x-ai/grok-4.1-fast',
          fullError: error instanceof Error ? error.message : String(error),
        });
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
    let fullReasoning = '';
    let chunkCount = 0;
    
    // Track tool calls being assembled from streaming chunks
    const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason: string | null = null;

    try {
      for await (const chunk of stream) {
        chunkCount++;
        
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Track finish reason
        if (choice.finish_reason || (choice as any).finishReason) {
          finishReason = choice.finish_reason || (choice as any).finishReason;
        }
        
        // Handle reasoning content (from models like o1)
        const reasoning = delta?.reasoning ?? (delta as any)?.reasoning_content ?? '';
        if (reasoning) {
          fullReasoning += reasoning;
          res.write(encoder.encode(`data: ${JSON.stringify({ reasoning })}\n\n`));
        }
        
        // Handle regular text content
        const content = delta?.content ?? '';
        if (content) {
          fullResponse += content;
          res.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
        }
        
        // Handle tool calls (assembled from streaming chunks)
        // Check both delta.tool_calls (OpenAI) and delta.toolCalls (camelCase fallback)
        const toolCalls = delta?.tool_calls || (delta as any)?.toolCalls || (choice as any).tool_calls || (choice as any).toolCalls;
        
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
            
            const func = toolCallDelta.function || (toolCallDelta as any).function;
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
            logger.info('Processing image generation tool call', {
              clientId,
              index,
              toolCallId: toolCall.id,
              arguments: toolCall.arguments,
            });
            
            try {
              const args = JSON.parse(toolCall.arguments) as { prompt: string; style?: string };
              const imageModel = body.imageModel || 'google/gemini-3-pro-image-preview';
              const imageUrl = await generateImage(transformedMessages, args.prompt, args.style, imageModel);
              
              // Send image response in special format
              res.write(encoder.encode(`data: ${JSON.stringify({ 
                type: 'image',
                content: imageUrl,
                prompt: args.prompt,
              })}\n\n`));
              
              fullResponse = `[IMAGE:${imageUrl}]`;
            } catch (imageError) {
              const errorMsg = imageError instanceof Error ? imageError.message : 'Image generation failed';
              logger.error('Image generation failed', { clientId, error: errorMsg, args: toolCall.arguments });
              res.write(encoder.encode(`data: ${JSON.stringify({ 
                error: `Failed to generate image: ${errorMsg}` 
              })}\n\n`));
            }
          }
        }
      }
      
      // Log warning if stream ended with no content and no tool calls
      if (fullResponse.length === 0 && fullReasoning.length === 0 && toolCallsInProgress.size === 0) {
        logger.warn('POST /api/v1/chat/stream ended with no content', {
          clientId,
          model: body.model || 'x-ai/grok-4.1-fast',
          chunkCount,
          finishReason,
          messagePreview: transformedMessages.filter((msg) => msg.role !== 'system').map((msg) => ({
            role: msg.role,
            content: typeof msg.content === 'string' 
              ? msg.content.substring(0, 300)
              : '[multipart content]',
          })),
        });
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
        reasoningLength: fullReasoning.length,
        chunkCount,
        finishReason,
        toolCallCount: toolCallsInProgress.size,
        statusCode: res.statusCode,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Stream error';
      logger.error('Chat stream error', {
        clientId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        chunkCount,
        fullResponseLength: fullResponse.length,
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

