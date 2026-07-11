import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
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

// Lifecycle stages the realunit.app confirm page reports to the durable client-event sink. Whitelisted:
// any other value is rejected (400) so the public endpoint cannot be used as an arbitrary log-injection
// surface.
export enum RealUnitConfirmAktionariatEventPhase {
  PAGE_LOADED = 'pageLoaded',
  MISSING_PARAMS = 'missingParams',
  REQUEST_SENT = 'requestSent',
  RESULT_CONFIRMED = 'resultConfirmed',
  RESULT_INVALID = 'resultInvalid',
  RESULT_UNAVAILABLE = 'resultUnavailable',
  REQUEST_ERROR = 'requestError',
}

// Public, unauthenticated body the confirm page POSTs at each lifecycle stage so the static web (strict CSP,
// no other durable log transport) gets a replayable audit trail. Every field is size-capped; only `phase` is
// required. The DB `log` is the designated PII audit store, so the user's own email/code carried here are
// acceptable to persist.
export class RealUnitConfirmAktionariatEventDto {
  @ApiProperty({ enum: RealUnitConfirmAktionariatEventPhase, description: 'Lifecycle stage being reported.' })
  @IsNotEmpty()
  @IsEnum(RealUnitConfirmAktionariatEventPhase)
  phase: RealUnitConfirmAktionariatEventPhase;

  @ApiPropertyOptional({ description: 'Email from the confirmation link, if present.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(Util.trim)
  email?: string;

  @ApiPropertyOptional({ description: 'Aktionariat confirmation code from the link, if present.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(Util.trim)
  code?: string;

  @ApiPropertyOptional({ description: 'Aktionariat user identifier from the link, if present.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(Util.trim)
  user?: string;

  @ApiPropertyOptional({ description: 'Free-text detail (e.g. a client-side error message).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(Util.trim)
  detail?: string;
}
