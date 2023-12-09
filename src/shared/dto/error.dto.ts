import { ApiProperty } from '@nestjs/swagger';

export class ErrorDto {
  @ApiProperty()
  error: string;

  @ApiProperty()
  message: string;

  @ApiProperty()
  statusCode: number;
}
