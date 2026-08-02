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
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    description:
      'Account ID the client reports for the signed-in user, absent when nobody is signed in. Correlation hint ' +
      'only: this endpoint is unauthenticated, so the value is whatever the request carried and says nothing ' +
      'about who sent it. A value that does not arrive as a positive safe integer is dropped rather than ' +
      'rejected, so a bad hint does not cost the report.',
  })
  @IsOptional()
  // Dropped here rather than rejected by a validator, which would reject the report along with the
  // value: the pipe answers 400 for the whole body, and losing message, stack and route over the
  // one field that only helps to find them is the blind spot this endpoint exists to close.
  //
  // The bound is on what arrives. The body is parsed first, and past the safe integers that parsing
  // is no longer faithful - which is what the bound is for, not something it can undo.
  @Transform(({ value }) => (Number.isSafeInteger(value) && value > 0 ? value : undefined))
  accountId?: number;
}
