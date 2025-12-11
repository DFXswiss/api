import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSafeAccountDto {
  @ApiProperty({ description: 'Title of the SafeAccount' })
  @IsString()
  @MaxLength(256)
  title: string;

  @ApiPropertyOptional({ description: 'Description of the SafeAccount' })
  @IsOptional()
  @IsString()
  description?: string;
}
