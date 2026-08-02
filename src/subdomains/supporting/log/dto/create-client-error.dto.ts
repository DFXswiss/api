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
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    description:
      'Account ID of the signed-in user, absent when nobody is signed in. Correlation hint only: this endpoint is ' +
      'unauthenticated, so the value is whatever the request carried and says nothing about who sent it. A value ' +
      'outside the range is dropped rather than rejected, so a bad hint does not cost the report.',
  })
  @IsOptional()
  // The range is enforced here rather than by a validator, because a validator would reject the
  // report along with the value: the pipe answers 400 for the whole body, and losing message,
  // stack and route over the one field that only helps to find them is the blind spot this
  // endpoint exists to close.
  //
  // The upper bound is where parsing stops being faithful: past the safe integers, ids that differ
  // arrive as the same number. It bounds what arrives, not what was written - the body is parsed
  // before anything here sees it, so a value written with a fractional part near the bound arrives
  // as an integer and is recorded as one. Nothing on this side can tell the two apart.
  @Transform(({ value }) => (Number.isSafeInteger(value) && value > 0 ? value : undefined))
  accountId?: number;
}
