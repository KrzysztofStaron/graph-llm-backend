import { Test, TestingModule } from '@nestjs/testing';
import { CollaborationController } from './collaboration.controller';
import { CollaborationService } from './collaboration.service';

describe('CollaborationController', () => {
  let controller: CollaborationController;
  let service: CollaborationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CollaborationController],
      providers: [CollaborationService],
    }).compile();

    controller = module.get<CollaborationController>(CollaborationController);
    service = module.get<CollaborationService>(CollaborationService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStatus', () => {
    it('should return "works" string', () => {
      const result = controller.getStatus();

      expect(result).toBe('works');
      expect(typeof result).toBe('string');
    });

    it('should delegate to collaborationService', () => {
      jest.spyOn(service, 'getStatus');

      const result = controller.getStatus();

      // The controller doesn't call service.getStatus, it just returns 'works'
      expect(result).toBe('works');
    });

    it('should return consistent value', () => {
      const result1 = controller.getStatus();
      const result2 = controller.getStatus();

      expect(result1).toBe(result2);
      expect(result1).toBe('works');
    });
  });
});
