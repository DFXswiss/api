import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RetryPayoutDto {
  @IsNotEmpty()
  @IsInt()
  @Type(() => Number)
  id: number;

  // Explicit operator confirmation that on-chain absence was verified — the endpoint must
  // refuse anything but literal true.
  @IsNotEmpty()
  @IsBoolean()
  noBroadcastVerified: boolean;

  // What was checked (explorer links, ticket, tooling reference) — becomes part of the audit log.
  @IsNotEmpty()
  @IsString()
  @MaxLength(1024)
  verificationReference: string;
}
