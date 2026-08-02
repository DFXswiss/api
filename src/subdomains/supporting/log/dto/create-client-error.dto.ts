import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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
      'unauthenticated, so the value is whatever the request carried and says nothing about who sent it. A value ' +
      'outside 1..2^53-1 is dropped rather than rejected, so a bad hint does not cost the report.',
  })
  @IsOptional()
  // Dropped, not rejected: the pipe answers 400 for the whole body, and losing message, stack and
  // route over the one field that only helps to find them is the blind spot this endpoint exists
  // to close. The range is what the value has to be to stay the value that was sent - beyond the
  // safe integers, parsing the body rounds, and two different ids arrive as the same one.
  @Transform(({ value }) => (Number.isSafeInteger(value) && value > 0 ? value : undefined))
  // Kept as the contract this field advertises, in Swagger and to a reader. The transform above
  // means they are never what rejects a report.
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  accountId?: number;
}
