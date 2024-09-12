import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class CreateSupportMessageDto {
  @IsOptional()
  @IsString()
  author: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @ValidateIf((m: CreateSupportMessageDto) => Boolean(!m.file || m.message))
  message?: string;

  @ApiPropertyOptional({ description: 'Base64 encoded file' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @ValidateIf((m: CreateSupportMessageDto) => Boolean(!m.message || m.file))
  file?: string;

  @ApiPropertyOptional({ description: 'Name of the file' })
  @ValidateIf((l: CreateSupportMessageDto) => l.file != null)
  @IsNotEmpty()
  @IsString()
  fileName?: string;
}
