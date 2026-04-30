import { IsOptional, IsString } from 'class-validator';

export class UpdatePaymentLinkPaymentDto {
  @IsOptional()
  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  deviceCommand: string;
}
