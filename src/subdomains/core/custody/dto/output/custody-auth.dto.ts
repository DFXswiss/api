import { ApiProperty } from '@nestjs/swagger';

export class CustodyAuthDto {
  @ApiProperty({ description: 'Access token of DFX API' })
  accessToken: string;
}
