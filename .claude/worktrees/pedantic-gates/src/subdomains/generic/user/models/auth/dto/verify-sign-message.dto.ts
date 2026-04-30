import { ApiProperty } from '@nestjs/swagger';

export class VerifySignMessageDto {
  @ApiProperty({ description: 'Result of message signature verification' })
  isValid: boolean;
}
