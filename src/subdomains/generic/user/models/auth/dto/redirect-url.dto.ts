import { ApiProperty } from '@nestjs/swagger';

export class MergeRedirectDto {
  @ApiProperty({
    description: 'KYC hash',
  })
  kycHash: string;

  @ApiProperty({
    description: 'Access token of DFX API',
  })
  accessToken?: string;
}
