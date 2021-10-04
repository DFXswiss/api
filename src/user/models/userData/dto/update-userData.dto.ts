import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, IsEnum } from 'class-validator';
import { NameCheckStatus } from '../userData.entity';

export class UpdateUserDataDto {
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(NameCheckStatus)
  nameCheck: NameCheckStatus;
}
