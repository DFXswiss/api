import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, IsNumber } from 'class-validator';

export class UpdateUserDataDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  monthlyValue: number;
}
