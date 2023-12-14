import { ApiProperty } from '@nestjs/swagger';

export class MinAmount {
  @ApiProperty()
  amount: number;

  @ApiProperty()
  asset: string;
}
