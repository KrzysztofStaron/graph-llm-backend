import { Injectable } from '@nestjs/common';

@Injectable()
export class CollaborationService {
  getStatus(): string {
    return 'works';
  }
}
