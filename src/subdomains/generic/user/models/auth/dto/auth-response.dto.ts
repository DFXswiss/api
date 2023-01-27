import { ApiProperty } from '@nestjs/swagger';

export class AuthResponseDto {
  @ApiProperty({
    description: 'Access token of DFX API',
  })
  accessToken: string;
}
