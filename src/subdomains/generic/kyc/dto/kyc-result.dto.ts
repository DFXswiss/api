import { ApiProperty } from '@nestjs/swagger';

export class KycResultDto {
  @ApiProperty()
  done: boolean;
}
