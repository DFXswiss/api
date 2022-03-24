import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDate } from 'class-validator';

export class UpdateCryptoStakingDto {
  @ApiPropertyOptional()
  @IsDate()
  outputDate: Date;
}
