import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSafeAccountDto {
  @ApiPropertyOptional({ description: 'Title of the SafeAccount' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional({ description: 'Description of the SafeAccount' })
  @IsOptional()
  @IsString()
  description?: string;
}
