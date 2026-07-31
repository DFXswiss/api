import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class CreateClientErrorDto {
  @ApiProperty({ description: 'Error message' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  @MaxLength(500)
  message: string;

  @ApiPropertyOptional({ description: 'Error type (e.g. ChunkLoadError, TypeError)' })
  @IsOptional()
  @IsString()
  @Transform(Util.trim)
  @MaxLength(100)
  type?: string;

  @ApiPropertyOptional({ description: 'Stack trace' })
  @IsOptional()
  @IsString()
  @Transform(Util.trim)
  @MaxLength(4000)
  stack?: string;

  @ApiPropertyOptional({ description: 'Route the error occurred on (query string is discarded server-side)' })
  @IsOptional()
  @IsString()
  @Transform(Util.trim)
  @MaxLength(500)
  route?: string;

  @ApiPropertyOptional({ description: 'Frontend build version' })
  @IsOptional()
  @IsString()
  @Transform(Util.trim)
  @MaxLength(50)
  version?: string;
}
