import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class CreateSupportMessageDto {
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  author: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @ValidateIf((m: CreateSupportMessageDto) => Boolean(!m.file || m.message))
  message?: string;

  @ApiPropertyOptional({ description: 'Base64 encoded file' })
  @IsNotEmpty()
  @IsString()
  @ValidateIf((m: CreateSupportMessageDto) => Boolean(!m.message || m.file))
  file?: string;

  @ApiPropertyOptional({ description: 'Name of the file' })
  @ValidateIf((l: CreateSupportMessageDto) => l.file != null)
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  fileName?: string;
}
