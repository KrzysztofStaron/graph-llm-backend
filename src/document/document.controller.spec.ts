import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentParserService } from './document-parser.service';
import { Response } from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';

describe('DocumentController', () => {
  let controller: DocumentController;
  let parserService: DocumentParserService;
  let mockResponse: Partial<Response>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [
        {
          provide: DocumentParserService,
          useValue: {
            parseDocument: jest.fn(),
          },
        },
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

    controller = module.get<DocumentController>(DocumentController);
    parserService = module.get<DocumentParserService>(DocumentParserService);

    // Create mock response object
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('parseDocument', () => {
    it('should parse a valid PDF file', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.from('test pdf'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const parsedText = 'Parsed PDF content';
      jest.spyOn(parserService, 'parseDocument').mockResolvedValue(parsedText);

      await controller.parseDocument(mockFile, mockResponse as Response);

      expect(parserService.parseDocument).toHaveBeenCalledWith(
        mockFile.buffer,
        mockFile.mimetype,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        text: parsedText,
        metadata: {
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        },
      });
    });

    it('should parse a valid DOCX file', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'document.docx',
        encoding: '7bit',
        mimetype:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('test docx'),
        size: 2048,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const parsedText = 'Parsed DOCX content';
      jest.spyOn(parserService, 'parseDocument').mockResolvedValue(parsedText);

      await controller.parseDocument(mockFile, mockResponse as Response);

      expect(parserService.parseDocument).toHaveBeenCalledWith(
        mockFile.buffer,
        mockFile.mimetype,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        text: parsedText,
        metadata: {
          filename: 'document.docx',
          mimeType: mockFile.mimetype,
          size: 2048,
        },
      });
    });

    it('should return 400 if no file is provided', async () => {
      await controller.parseDocument(
        undefined as any,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'No file provided',
      });
    });

    it('should return 400 if file is too large', async () => {
      const largeFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'large.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.alloc(26 * 1024 * 1024), // 26MB
        size: 26 * 1024 * 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      await controller.parseDocument(largeFile, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'File too large',
        details: 'Maximum file size is 25MB',
      });
    });

    it('should accept file at maximum size limit (25MB)', async () => {
      const maxSizeFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'max.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.alloc(25 * 1024 * 1024), // Exactly 25MB
        size: 25 * 1024 * 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      jest.spyOn(parserService, 'parseDocument').mockResolvedValue('Content');

      await controller.parseDocument(maxSizeFile, mockResponse as Response);

      expect(parserService.parseDocument).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('should return 400 for unsupported MIME type', async () => {
      const unsupportedFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'file.exe',
        encoding: '7bit',
        mimetype: 'application/x-msdownload',
        buffer: Buffer.from('test'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      await controller.parseDocument(unsupportedFile, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unsupported file type',
        details: 'MIME type application/x-msdownload is not allowed',
      });
    });

    it('should accept all allowed MIME types', async () => {
      const allowedTypes = [
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

      for (const mimeType of allowedTypes) {
        const mockFile: Express.Multer.File = {
          fieldname: 'file',
          originalname: 'test.file',
          encoding: '7bit',
          mimetype: mimeType,
          buffer: Buffer.from('test'),
          size: 1024,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        jest.spyOn(parserService, 'parseDocument').mockResolvedValue('Content');
        const response = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn().mockReturnThis(),
        };

        await controller.parseDocument(mockFile, response as any);

        expect(response.status).not.toHaveBeenCalledWith(
          HttpStatus.BAD_REQUEST,
        );
      }
    });

    it('should accept any text/* MIME type', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.txt',
        encoding: '7bit',
        mimetype: 'text/custom',
        buffer: Buffer.from('test'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      jest.spyOn(parserService, 'parseDocument').mockResolvedValue('Content');

      await controller.parseDocument(mockFile, mockResponse as Response);

      expect(parserService.parseDocument).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('should handle missing mimetype by defaulting to application/octet-stream', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.file',
        encoding: '7bit',
        mimetype: undefined as any,
        buffer: Buffer.from('test'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      await controller.parseDocument(mockFile, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unsupported file type',
        details: 'MIME type undefined is not allowed',
      });
    });

    it('should handle parsing errors', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.from('test'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const errorMessage = 'Failed to parse: corrupt file';
      jest
        .spyOn(parserService, 'parseDocument')
        .mockRejectedValue(new Error(errorMessage));

      await controller.parseDocument(mockFile, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to parse document',
        details: errorMessage,
      });
    });

    it('should handle unknown parsing errors', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.from('test'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      jest
        .spyOn(parserService, 'parseDocument')
        .mockRejectedValue('Unknown error string');

      await controller.parseDocument(mockFile, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to parse document',
        details: 'Unknown error',
      });
    });

    it('should handle case-insensitive MIME type validation', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.pdf',
        encoding: '7bit',
        mimetype: 'APPLICATION/PDF', // uppercase
        buffer: Buffer.from('test'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      jest.spyOn(parserService, 'parseDocument').mockResolvedValue('Content');

      await controller.parseDocument(mockFile, mockResponse as Response);

      expect(parserService.parseDocument).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();
    });
  });
});
