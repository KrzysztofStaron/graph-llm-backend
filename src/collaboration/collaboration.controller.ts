import { Controller, Get } from '@nestjs/common';
import { CollaborationService } from './collaboration.service';

@Controller('api/v1/collaboration')
export class CollaborationController {
  constructor(private readonly collaborationService: CollaborationService) {}

  @Get()
  getStatus(): string {
    return 'works';
  }
}
