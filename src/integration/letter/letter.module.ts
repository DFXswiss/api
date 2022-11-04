import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { LetterService } from './letter.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [LetterService],
  exports: [LetterService],
})
export class LetterModule {}
