import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class CreateSupportMessageDto {
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  author?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  message?: string;

  @ApiPropertyOptional({ description: 'Base64 encoded file' })
  @IsOptional()
  @IsString()
  file?: string;

  @ApiPropertyOptional({ description: 'Name of the file' })
  @ValidateIf((l: CreateSupportMessageDto) => l.file != null)
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  fileName?: string;
}
