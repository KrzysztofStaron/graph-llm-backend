import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Options,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DocumentParserService } from './document-parser.service';

@Controller('api/v1/document')
export class DocumentController {
  constructor(private readonly documentParserService: DocumentParserService) {}

  @Options('parse')
  parseOptions(@Res() res: Response): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).send();
  }

  @Post('parse')
  @UseInterceptors(FileInterceptor('file'))
  async parseDocument(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ): Promise<void> {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (!file) {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: 'No file provided',
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
