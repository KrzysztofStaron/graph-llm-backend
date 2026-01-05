import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import logger from '../logger';

@Controller('api/v1/text-to-speech')
export class TtsController {
  @Post()
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

