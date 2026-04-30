import { IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class KycWebhookTriggerDto {
  @ValidateIf((b: KycWebhookTriggerDto) => Boolean(b.userDataId || !b.kycStepId))
  @IsNotEmpty()
  @IsInt()
  userDataId: number;

  @ValidateIf((b: KycWebhookTriggerDto) => Boolean(b.kycStepId || !b.userDataId))
  @IsNotEmpty()
  @IsInt()
  kycStepId: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
