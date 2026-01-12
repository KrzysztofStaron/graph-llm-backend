import { Test, TestingModule } from '@nestjs/testing';
import { CollaborationService } from './collaboration.service';

describe('CollaborationService', () => {
  let service: CollaborationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CollaborationService],
    }).compile();

    service = module.get<CollaborationService>(CollaborationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStatus', () => {
    it('should return "works" string', () => {
      const result = service.getStatus();

      expect(result).toBe('works');
      expect(typeof result).toBe('string');
    });

    it('should return consistent result on multiple calls', () => {
      const result1 = service.getStatus();
      const result2 = service.getStatus();
      const result3 = service.getStatus();

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });
});
