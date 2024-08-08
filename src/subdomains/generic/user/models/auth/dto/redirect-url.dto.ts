import { ApiProperty } from '@nestjs/swagger';

export class RedirectUrlDto {
  @ApiProperty({
    description: 'Redirect URL',
  })
  redirectUrl: string;
}
