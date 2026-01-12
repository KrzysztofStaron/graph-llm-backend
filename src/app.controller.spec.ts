import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('root', () => {
    it('should return API documentation string', () => {
      const result = controller.root();

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toContain('Graph LLM Backend');
      expect(result).toContain('Available endpoints');
    });

    it('should list all available endpoints', () => {
      const result = controller.root();

      expect(result).toContain('GET      /');
      expect(result).toContain('POST     /api/v1/chat');
      expect(result).toContain('OPTIONS  /api/v1/chat/stream');
      expect(result).toContain('POST     /api/v1/chat/stream');
      expect(result).toContain('OPTIONS  /api/v1/text-to-speech');
      expect(result).toContain('POST     /api/v1/text-to-speech');
    });

    it('should return trimmed string without leading/trailing whitespace', () => {
      const result = controller.root();

      expect(result).toBe(result.trim());
      expect(result.startsWith(' ')).toBe(false);
      expect(result.endsWith(' ')).toBe(false);
    });
  });
});
