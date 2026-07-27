import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Util } from 'src/shared/utils/util';

/**
 * Manual release of an order whose outcome the venue could not confirm.
 *
 * The automatic reconciliation can only ever prove the positive — that the venue knows the reference. It
 * never concludes the negative, because no venue reply establishes "this was never accepted". Somebody has
 * to look, and this is where that judgement is recorded.
 *
 * Modelled on the payout subdomain's guarded retry: an explicit assertion plus a verifiable reference, so
 * the decision is deliberate and auditable rather than a status flip.
 */
export class ResolveUncertainOrderDto {
  @ApiProperty({
    description:
      'Assertion that the venue was checked directly and the request demonstrably never took effect. ' +
      'Required, and required to be true — releasing an order whose outcome is still open risks executing it twice.',
  })
  @IsNotEmpty()
  @IsBoolean()
  @IsIn([true], { message: 'noExecutionVerified must be true — an unverified order must stay quarantined' })
  noExecutionVerified: boolean;

  @ApiProperty({ description: 'Where that was checked, so the decision can be audited later.' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  @MinLength(3)
  @MaxLength(1024)
  verificationReference: string;
}
