import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class CreateSupportMessageDto {
  @IsOptional()
  @IsString()
  author: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  message: string;

  @ApiPropertyOptional({ description: 'Base64 encoded file' })
  @IsOptional()
  @IsString()
  file?: string;

  @ApiPropertyOptional({ description: 'Name of the file' })
  @ValidateIf((l: CreateSupportMessageDto) => l.file != null)
  @IsNotEmpty()
  @IsString()
  fileName?: string;
}
