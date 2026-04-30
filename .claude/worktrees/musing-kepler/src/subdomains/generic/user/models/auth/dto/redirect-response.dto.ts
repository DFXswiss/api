import { ApiProperty } from '@nestjs/swagger';

export class RedirectResponseDto {
  @ApiProperty({
    description: 'Redirect URL',
  })
  redirectUrl: string;
}
