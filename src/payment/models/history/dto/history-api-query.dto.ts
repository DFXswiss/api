import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { HistoryQuery } from './history-query.dto';

export class HistoryApiQuery extends HistoryQuery {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  apiKey: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  timestamp: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  apiSign: string;
}
