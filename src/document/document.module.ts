import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentParserService } from './document-parser.service';

@Module({
  controllers: [DocumentController],
  providers: [DocumentParserService],
  exports: [DocumentParserService],
})
export class DocumentModule {}
