import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';

describe('StorageController', () => {
  let controller: StorageController;
  let storageService: StorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        {
          provide: StorageService,
          useValue: {
            uploadImage: jest.fn(),
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

    controller = module.get<StorageController>(StorageController);
    storageService = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('uploadImage', () => {
    it('should upload an image successfully', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const mockResult = {
        url: 'https://example.com/image.jpg',
        filename: 'images/123456-abcdef.jpg',
      };

      jest.spyOn(storageService, 'uploadImage').mockResolvedValue(mockResult);

      const result = await controller.uploadImage(mockFile);

      expect(storageService.uploadImage).toHaveBeenCalledWith(mockFile);
      expect(result).toEqual({
        success: true,
        url: mockResult.url,
        filename: mockResult.filename,
      });
    });

    it('should throw error if no file is provided', async () => {
      await expect(controller.uploadImage(undefined as any)).rejects.toThrow(
        HttpException,
      );
      await expect(controller.uploadImage(undefined as any)).rejects.toThrow(
        'No file provided',
      );
    });

    it('should throw HttpException with BAD_REQUEST status when no file provided', async () => {
      let error: HttpException | null = null;
      try {
        await controller.uploadImage(undefined as any);
      } catch (e) {
        error = e as HttpException;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect(error?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should handle upload errors from service', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      jest
        .spyOn(storageService, 'uploadImage')
        .mockRejectedValue(
          new HttpException('Upload failed', HttpStatus.INTERNAL_SERVER_ERROR),
        );

      await expect(controller.uploadImage(mockFile)).rejects.toThrow(
        HttpException,
      );
      await expect(controller.uploadImage(mockFile)).rejects.toThrow(
        'Upload failed',
      );
    });

    it('should return success: true on successful upload', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'photo.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: Buffer.from('fake image'),
        size: 2048,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      jest.spyOn(storageService, 'uploadImage').mockResolvedValue({
        url: 'https://example.com/photo.png',
        filename: 'images/photo.png',
      });

      const result = await controller.uploadImage(mockFile);

      expect(result.success).toBe(true);
    });

    it('should include url in response', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const expectedUrl = 'https://storage.example.com/images/test.jpg';
      jest.spyOn(storageService, 'uploadImage').mockResolvedValue({
        url: expectedUrl,
        filename: 'images/test.jpg',
      });

      const result = await controller.uploadImage(mockFile);

      expect(result.url).toBe(expectedUrl);
    });

    it('should include filename in response', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const expectedFilename = 'images/1234567890-abcdef.jpg';
      jest.spyOn(storageService, 'uploadImage').mockResolvedValue({
        url: 'https://example.com/image.jpg',
        filename: expectedFilename,
      });

      const result = await controller.uploadImage(mockFile);

      expect(result.filename).toBe(expectedFilename);
    });

    it('should handle various image types', async () => {
      const imageTypes = [
        { ext: 'jpg', mime: 'image/jpeg' },
        { ext: 'png', mime: 'image/png' },
        { ext: 'gif', mime: 'image/gif' },
        { ext: 'webp', mime: 'image/webp' },
      ];

      for (const type of imageTypes) {
        const mockFile: Express.Multer.File = {
          fieldname: 'file',
          originalname: `test.${type.ext}`,
          encoding: '7bit',
          mimetype: type.mime,
          buffer: Buffer.from('fake image'),
          size: 1024,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        jest.spyOn(storageService, 'uploadImage').mockResolvedValue({
          url: `https://example.com/image.${type.ext}`,
          filename: `images/test.${type.ext}`,
        });

        const result = await controller.uploadImage(mockFile);

        expect(result.success).toBe(true);
        expect(storageService.uploadImage).toHaveBeenCalledWith(mockFile);
      }
    });

    it('should propagate service errors without modification', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.txt',
        encoding: '7bit',
        mimetype: 'text/plain',
        buffer: Buffer.from('text'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const serviceError = new HttpException(
        'Invalid file type',
        HttpStatus.BAD_REQUEST,
      );
      jest.spyOn(storageService, 'uploadImage').mockRejectedValue(serviceError);

      await expect(controller.uploadImage(mockFile)).rejects.toBe(serviceError);
    });
  });
});
