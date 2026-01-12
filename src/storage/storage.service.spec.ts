import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { StorageService } from './storage.service';
import * as firebaseApp from 'firebase/app';
import * as firebaseStorage from 'firebase/storage';

jest.mock('firebase/app');
jest.mock('firebase/storage');

describe('StorageService', () => {
  let service: StorageService;
  let mockStorage: any;
  let mockStorageRef: any;

  beforeEach(async () => {
    // Mock Firebase app
    const mockApp = { name: 'test-app' };
    (firebaseApp.getApp as jest.Mock).mockImplementation(() => {
      throw new Error('No app');
    });
    (firebaseApp.initializeApp as jest.Mock).mockReturnValue(mockApp);

    // Mock Firebase storage
    mockStorage = { bucket: 'test-bucket' };
    mockStorageRef = { fullPath: 'test-path' };
    (firebaseStorage.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (firebaseStorage.ref as jest.Mock).mockReturnValue(mockStorageRef);
    (firebaseStorage.uploadBytes as jest.Mock).mockResolvedValue({
      ref: mockStorageRef,
    });
    (firebaseStorage.getDownloadURL as jest.Mock).mockResolvedValue(
      'https://example.com/image.jpg',
    );
    (firebaseStorage.deleteObject as jest.Mock).mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [StorageService],
    }).compile();

    service = module.get<StorageService>(StorageService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadImage', () => {
    it('should upload a valid JPEG image', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image data'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const result = await service.uploadImage(mockFile);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('filename');
      expect(result.url).toBe('https://example.com/image.jpg');
      expect(result.filename).toContain('images/');
      expect(result.filename).toContain('.jpg');
    });

    it('should upload a valid PNG image', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: Buffer.from('fake image data'),
        size: 2048,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const result = await service.uploadImage(mockFile);

      expect(result.filename).toContain('.png');
      expect(firebaseStorage.uploadBytes).toHaveBeenCalled();
    });

    it('should upload a valid GIF image', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.gif',
        encoding: '7bit',
        mimetype: 'image/gif',
        buffer: Buffer.from('fake image data'),
        size: 3072,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const result = await service.uploadImage(mockFile);

      expect(result.filename).toContain('.gif');
    });

    it('should upload a valid WEBP image', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.webp',
        encoding: '7bit',
        mimetype: 'image/webp',
        buffer: Buffer.from('fake image data'),
        size: 4096,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const result = await service.uploadImage(mockFile);

      expect(result.filename).toContain('.webp');
    });

    it('should throw error for invalid MIME type', async () => {
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

      await expect(service.uploadImage(mockFile)).rejects.toThrow(
        HttpException,
      );
      await expect(service.uploadImage(mockFile)).rejects.toThrow(
        'Invalid file type. Allowed types: image/jpeg, image/jpg, image/png, image/gif, image/webp',
      );
    });

    it('should throw error for file larger than 10MB', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'large.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.alloc(11 * 1024 * 1024), // 11MB
        size: 11 * 1024 * 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      await expect(service.uploadImage(mockFile)).rejects.toThrow(
        HttpException,
      );
      await expect(service.uploadImage(mockFile)).rejects.toThrow(
        'File too large. Maximum size is 10MB',
      );
    });

    it('should accept file at maximum size limit (10MB)', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'max.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.alloc(10 * 1024 * 1024), // Exactly 10MB
        size: 10 * 1024 * 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const result = await service.uploadImage(mockFile);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('filename');
    });

    it('should generate unique filenames using hash and timestamp', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image data'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const result1 = await service.uploadImage(mockFile);

      // Wait a millisecond to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 1));

      const result2 = await service.uploadImage(mockFile);

      expect(result1.filename).not.toBe(result2.filename);
      expect(result1.filename).toMatch(/^images\/\d+-[a-f0-9]{16}\.jpg$/);
      expect(result2.filename).toMatch(/^images\/\d+-[a-f0-9]{16}\.jpg$/);
    });

    it('should set correct metadata when uploading', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test-image.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image data'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      await service.uploadImage(mockFile);

      expect(firebaseStorage.uploadBytes).toHaveBeenCalledWith(
        mockStorageRef,
        mockFile.buffer,
        expect.objectContaining({
          contentType: 'image/jpeg',
          customMetadata: expect.objectContaining({
            originalName: 'test-image.jpg',
            uploadedAt: expect.any(String),
          }),
        }),
      );
    });

    it('should handle jpg extension correctly', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'photo.jpg',
        encoding: '7bit',
        mimetype: 'image/jpg',
        buffer: Buffer.from('fake image data'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const result = await service.uploadImage(mockFile);

      expect(result.filename).toContain('.jpg');
    });

    it('should handle filename without extension', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'noextension',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image data'),
        size: 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const result = await service.uploadImage(mockFile);

      // The service uses the last part of filename or defaults to 'jpg'
      // In this case 'noextension' becomes the extension
      expect(result.filename).toMatch(
        /^images\/\d+-[a-f0-9]{16}\.noextension$/,
      );
    });

    it('should throw HttpException with correct status code for invalid type', async () => {
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

      let error: HttpException | null = null;
      try {
        await service.uploadImage(mockFile);
      } catch (e) {
        error = e as HttpException;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect(error?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should throw HttpException with correct status code for large file', async () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'large.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.alloc(11 * 1024 * 1024),
        size: 11 * 1024 * 1024,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      let error: HttpException | null = null;
      try {
        await service.uploadImage(mockFile);
      } catch (e) {
        error = e as HttpException;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect(error?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('deleteImage', () => {
    it('should delete an image by filename', async () => {
      const filename = 'images/1234567890-abcdef1234567890.jpg';

      await service.deleteImage(filename);

      expect(firebaseStorage.ref).toHaveBeenCalledWith(mockStorage, filename);
      expect(firebaseStorage.deleteObject).toHaveBeenCalledWith(mockStorageRef);
    });

    it('should handle deletion errors', async () => {
      const filename = 'images/nonexistent.jpg';
      const errorMessage = 'File not found';
      (firebaseStorage.deleteObject as jest.Mock).mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(service.deleteImage(filename)).rejects.toThrow(errorMessage);
    });

    it('should accept different file paths', async () => {
      const filenames = [
        'images/test1.jpg',
        'images/test2.png',
        'images/subfolder/test3.gif',
      ];

      for (const filename of filenames) {
        await service.deleteImage(filename);
        expect(firebaseStorage.ref).toHaveBeenCalledWith(mockStorage, filename);
      }
    });
  });

  describe('constructor', () => {
    it('should use existing Firebase app if available', () => {
      const mockExistingApp = { name: 'existing-app' };
      (firebaseApp.getApp as jest.Mock).mockReturnValue(mockExistingApp);

      new StorageService();

      expect(firebaseApp.getApp).toHaveBeenCalled();
    });

    it('should initialize Firebase app if not exists', () => {
      (firebaseApp.getApp as jest.Mock).mockImplementation(() => {
        throw new Error('No app');
      });

      new StorageService();

      expect(firebaseApp.initializeApp).toHaveBeenCalled();
    });

    it('should initialize with environment variables if provided', () => {
      process.env.FIREBASE_API_KEY = 'test-api-key';
      process.env.FIREBASE_PROJECT_ID = 'test-project';

      (firebaseApp.getApp as jest.Mock).mockImplementation(() => {
        throw new Error('No app');
      });

      new StorageService();

      expect(firebaseApp.initializeApp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-api-key',
          projectId: 'test-project',
        }),
      );

      delete process.env.FIREBASE_API_KEY;
      delete process.env.FIREBASE_PROJECT_ID;
    });
  });
});
