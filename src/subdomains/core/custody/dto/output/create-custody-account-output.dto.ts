import { ApiProperty } from '@nestjs/swagger';

export class CustodyAuthResponseDto {
  @ApiProperty({
    description: 'Access token of DFX API',
  })
  accessToken: string;
}
