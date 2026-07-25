import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { ReceiveIbanStatus } from './receive-iban.enum';

// No @Transform(Util.sanitize) here: Util.sanitizeString calls value.trim() without a type check (util.ts,
// same in Util.trim and Util.trimAll), and @Transform runs before @IsString - so a non-string body would
// throw a TypeError that the exception filter reports as a 500 instead of a 400, on an endpoint reachable
// without a JWT. Validation alone rejects it cleanly; the service normalizes the string afterwards.
export class CheckReceiveIbanDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  iban: string;
}

export class ReceiveIbanDto {
  @ApiProperty({ enum: ReceiveIbanStatus })
  status: ReceiveIbanStatus;
}
