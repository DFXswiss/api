import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export enum RealUnitAktionariatConfirmationStatus {
  // Aktionariat accepted the confirmation (HTTP 2xx).
  CONFIRMED = 'confirmed',
  // The link is invalid or expired — Aktionariat rejected the code (HTTP 4xx).
  INVALID = 'invalid',
  // Aktionariat could not be reached or errored (HTTP 5xx / network / timeout). The client should
  // offer a retry; the confirmation state is unknown, not negative.
  UNAVAILABLE = 'unavailable',
}

export class RealUnitConfirmAktionariatQueryDto {
  @ApiProperty({ description: 'Email address the Aktionariat confirmation link was sent to' })
  @IsNotEmpty()
  @IsEmail()
  // The web forwards the email from the confirmation link verbatim, which may carry the original casing.
  // Normalise (trim + lowercase) instead of rejecting a non-lowercase value with a 400 the user reads as a
  // misleading "unavailable" retry loop; the lookup is case-insensitive on the API side regardless.
  @Transform(Util.toLowerCaseTrim)
  email: string;

  @ApiProperty({ description: 'Aktionariat confirmation code (acts as the authentication token for the call)' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  code: string;

  @ApiProperty({ description: 'Aktionariat user identifier from the confirmation link' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  user: string;
}

export class RealUnitConfirmAktionariatDto {
  @ApiProperty({
    enum: RealUnitAktionariatConfirmationStatus,
    description: 'Confirmation outcome mapped from the Aktionariat response.',
  })
  status: RealUnitAktionariatConfirmationStatus;

  @ApiProperty({
    type: [String],
    description: 'Wallet addresses registered for this email that were confirmed at Aktionariat by this call.',
  })
  confirmedAddresses: string[];

  @ApiPropertyOptional({ description: 'Timestamp of the confirmation, present only when the status is confirmed.' })
  confirmedDate?: Date;
}
