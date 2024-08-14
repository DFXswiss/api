import { ApiProperty } from '@nestjs/swagger';

export class MergeRedirectDto {
  @ApiProperty({
    description: 'Redirect URL',
  })
  redirectUrl: string;

  @ApiProperty({
    description: 'Access token of DFX API',
  })
  accessToken: string;
}
