import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
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

  @ApiPropertyOptional({
    description: 'Route the error occurred on (query string, fragment and matrix parameters are discarded server-side)',
  })
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

  @ApiPropertyOptional({
    description:
      'Account ID of the signed-in user, absent when nobody is signed in. Correlation hint only: this endpoint is ' +
      'unauthenticated, so the value is whatever the caller sent and says nothing about who they are.',
  })
  @IsOptional()
  @IsInt()
  accountId?: number;
}
