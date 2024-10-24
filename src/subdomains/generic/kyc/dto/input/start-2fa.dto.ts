import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { TfaLevel } from '../../services/tfa.service';

export class Start2faDto {
  @ApiPropertyOptional({ enum: TfaLevel, description: '2FA level' })
  @IsNotEmpty()
  @IsEnum(TfaLevel)
  level: TfaLevel = TfaLevel.STRICT;
}
