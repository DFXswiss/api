import { Module } from '@nestjs/common';
import { LetterService } from './letter.service';

@Module({
  imports: [],
  controllers: [],
  providers: [LetterService],
  exports: [LetterService],
})
export class LetterModule {}
