import { ApiProperty } from '@nestjs/swagger';

export class MinDeposit {
  @ApiProperty()
  amount: number;

  @ApiProperty()
  asset: string;
}
