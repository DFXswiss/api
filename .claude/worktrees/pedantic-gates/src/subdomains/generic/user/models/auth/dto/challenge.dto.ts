import { ApiProperty } from '@nestjs/swagger';

export class ChallengeDto {
  @ApiProperty({
    description: 'Challenge to sign',
  })
  challenge: string;
}
