import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { DocumentParserService } from './document-parser.service';

@Controller('api/v1/document')
export class DocumentController {
  constructor(private readonly documentParserService: DocumentParserService) {}

  @Post('parse')
  @UseInterceptors(FileInterceptor('file'))
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 200, ttl: 60000 } })
  async parseDocument(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ): Promise<void> {
    if (!file) {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: 'No file provided',
      });
      return;
    }

    // Security: Validate file size (max 25MB)
    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
    if (file.size > MAX_FILE_SIZE) {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: 'File too large',
        details: `Maximum file size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
      });
      return;
    }

    // Security: Validate file type
    const allowedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/html',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
    ];

    const mimeType = (
      file.mimetype || 'application/octet-stream'
    ).toLowerCase();
    // Allow text/* mime types and specific allowed types
    const isAllowed =
      mimeType.startsWith('text/') || allowedMimeTypes.includes(mimeType);

    if (!isAllowed) {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: 'Unsupported file type',
        details: `MIME type ${file.mimetype} is not allowed`,
      });
      return;
    }

    try {
      const text = await this.documentParserService.parseDocument(
        file.buffer,
        file.mimetype || 'application/octet-stream',
      );

      res.json({
        text,
        metadata: {
          filename: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      res.status(HttpStatus.BAD_REQUEST).json({
        error: 'Failed to parse document',
        details: errorMessage,
      });
    }
  }
}
