import { ApiProperty } from '@nestjs/swagger';

export class ApiKeyDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  secret: string;
}
