import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HttpService } from './services/http.service';
import { ConversionService } from './services/conversion.service';

@Module({
  imports: [HttpModule],
  providers: [ConversionService, HttpService],
  exports: [ConversionService, HttpService],
})
export class SharedModule {}
