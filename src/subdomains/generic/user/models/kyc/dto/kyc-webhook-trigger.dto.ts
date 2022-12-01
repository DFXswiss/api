import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class KycWebhookTriggerDto {
  @IsNotEmpty()
  @IsInt()
  userDataId: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
