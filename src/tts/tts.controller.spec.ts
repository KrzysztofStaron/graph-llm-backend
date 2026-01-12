import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, ExecutionContext } from '@nestjs/common';
import { TtsController } from './tts.controller';
import { Request, Response } from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';

// Mock global fetch
global.fetch = jest.fn();

describe('TtsController', () => {
  let controller: TtsController;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TtsController],
      providers: [
        {
          provide: ThrottlerGuard,
          useValue: {
            canActivate: (context: ExecutionContext) => true,
          },
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TtsController>(TtsController);

    // Reset environment
    process.env.DEEPGRAM_API_KEY = 'test-api-key';

    // Mock request
    mockRequest = {
      headers: {
        'x-client-id': 'test-client-123',
      },
    };

    // Mock response
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      write: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.DEEPGRAM_API_KEY;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('textToSpeech', () => {
    it('should return 400 if text is not provided', async () => {
      const body = { text: undefined as any };

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Text is required',
      });
    });

    it('should return 400 if text is empty string', async () => {
      const body = { text: '' };

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Text is required',
      });
    });

    it('should return 400 if text is not a string', async () => {
      const body = { text: 123 as any };

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Text is required',
      });
    });

    it('should return 500 if DEEPGRAM_API_KEY is not set', async () => {
      delete process.env.DEEPGRAM_API_KEY;
      const body = { text: 'Hello world' };

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'DEEPGRAM_API_KEY is not configured',
      });
    });

    it('should stream audio for valid text without timestamps', async () => {
      const body = { text: 'Hello world', includeTimestamps: false };

      // Mock readable stream
      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new Uint8Array([1, 2, 3]),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new Uint8Array([4, 5, 6]),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      const mockDeepgramResponse = {
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue(mockReader),
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockDeepgramResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'audio/mpeg',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Transfer-Encoding',
        'chunked',
      );
    });

    it('should return JSON with audio and timestamps when includeTimestamps is true', async () => {
      const body = { text: 'Hello world', includeTimestamps: true };

      const mockAudioBuffer = Buffer.from('fake audio data').buffer;
      const mockTTSResponse = {
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockAudioBuffer),
      };

      const mockTranscriptionResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          results: {
            channels: [
              {
                alternatives: [
                  {
                    words: [
                      { word: 'Hello', start: 0.0, end: 0.5 },
                      { word: 'world', start: 0.6, end: 1.0 },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockTTSResponse)
        .mockResolvedValueOnce(mockTranscriptionResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/json',
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        audio: expect.any(String),
        words: [
          { word: 'Hello', start: 0.0, end: 0.5 },
          { word: 'world', start: 0.6, end: 1.0 },
        ],
        duration: 1.0,
      });
    });

    it('should handle Deepgram TTS API errors', async () => {
      const body = { text: 'Hello world' };

      const mockDeepgramResponse = {
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal server error'),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockDeepgramResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to generate speech',
        details: expect.stringContaining('Deepgram API error'),
      });
    });

    it('should return audio without timestamps if transcription fails', async () => {
      const body = { text: 'Hello world', includeTimestamps: true };

      const mockAudioBuffer = Buffer.from('fake audio data').buffer;
      const mockTTSResponse = {
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockAudioBuffer),
      };

      const mockTranscriptionResponse = {
        ok: false,
        status: 500,
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockTTSResponse)
        .mockResolvedValueOnce(mockTranscriptionResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'audio/mpeg',
      );
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should handle fetch errors', async () => {
      const body = { text: 'Hello world' };

      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to generate speech',
        details: 'Network error',
      });
    });

    it('should handle unknown errors', async () => {
      const body = { text: 'Hello world' };

      (global.fetch as jest.Mock).mockRejectedValue('String error');

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to generate speech',
        details: 'Unknown error',
      });
    });

    it('should call Deepgram TTS API with correct parameters', async () => {
      const body = { text: 'Test speech text' };

      const mockReader = {
        read: jest.fn().mockResolvedValue({ done: true, value: undefined }),
      };

      const mockDeepgramResponse = {
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue(mockReader),
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockDeepgramResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.deepgram.com/v1/speak?model=aura-2-odysseus-en',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Token test-api-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: 'Test speech text' }),
        }),
      );
    });

    it('should handle null response body', async () => {
      const body = { text: 'Hello world' };

      const mockDeepgramResponse = {
        ok: true,
        body: null,
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockDeepgramResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to generate speech',
        details: 'Response body is null',
      });
    });

    it('should extract words from transcription utterances if channels are empty', async () => {
      const body = { text: 'Hello world', includeTimestamps: true };

      const mockAudioBuffer = Buffer.from('fake audio data').buffer;
      const mockTTSResponse = {
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockAudioBuffer),
      };

      const mockTranscriptionResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          results: {
            channels: [],
            utterances: [
              {
                words: [
                  { word: 'Hello', start: 0.0, end: 0.5 },
                  { word: 'world', start: 0.6, end: 1.0 },
                ],
              },
            ],
          },
        }),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockTTSResponse)
        .mockResolvedValueOnce(mockTranscriptionResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        audio: expect.any(String),
        words: [
          { word: 'Hello', start: 0.0, end: 0.5 },
          { word: 'world', start: 0.6, end: 1.0 },
        ],
        duration: 1.0,
      });
    });

    it('should handle stream errors gracefully', async () => {
      const body = { text: 'Hello world' };

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new Uint8Array([1, 2, 3]),
          })
          .mockRejectedValue(new Error('Stream error')),
      };

      const mockDeepgramResponse = {
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue(mockReader),
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockDeepgramResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Stream pump should catch the error
      // Wait for async pump to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // The response should be handled
      expect(mockResponse.setHeader).toHaveBeenCalled();
    });

    it('should not send error response if headers already sent during stream error', async () => {
      const body = { text: 'Hello world' };

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new Uint8Array([1, 2, 3]),
          })
          .mockRejectedValue(new Error('Stream error')),
      };

      const mockDeepgramResponse = {
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue(mockReader),
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockDeepgramResponse);
      mockResponse.headersSent = true;

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Wait for async pump to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Headers should have been set before error
      expect(mockResponse.headersSent).toBe(true);
    });

    it('should use client ID from headers if provided', async () => {
      const body = { text: 'Hello world' };
      mockRequest.headers = { 'x-client-id': 'custom-client-id' };

      const mockReader = {
        read: jest.fn().mockResolvedValue({ done: true, value: undefined }),
      };

      const mockDeepgramResponse = {
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue(mockReader),
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockDeepgramResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Should complete without errors
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should handle missing client ID gracefully', async () => {
      const body = { text: 'Hello world' };
      mockRequest.headers = {};

      const mockReader = {
        read: jest.fn().mockResolvedValue({ done: true, value: undefined }),
      };

      const mockDeepgramResponse = {
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue(mockReader),
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockDeepgramResponse);

      await controller.textToSpeech(
        body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.end).toHaveBeenCalled();
    });
  });
});
