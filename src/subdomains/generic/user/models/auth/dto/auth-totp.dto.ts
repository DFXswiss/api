import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AuthTotpDto {
  @ApiProperty({
    description: 'KYC Hash for 2FA Secret',
  })
  @IsString()
  kycHash: string;

  @ApiPropertyOptional({
    description: '2FA token',
  })
  @IsString()
  token?: string;
}
