import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MergeResponseDto {
  @ApiProperty({
    description: 'KYC hash',
  })
  kycHash: string;

  @ApiPropertyOptional({
    description: 'Updated access token',
  })
  accessToken?: string;
}
