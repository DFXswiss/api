import { ApiProperty } from '@nestjs/swagger';

export class Setup2faDto {
  @ApiProperty()
  secret: string;

  @ApiProperty()
  uri: string;
}
