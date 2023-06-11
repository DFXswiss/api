import { ApiProperty } from '@nestjs/swagger';

export class BerndWalletBalanceDto {
  @ApiProperty()
  lnd: {
    confirmedWalletBalance: number;
    localChannelBalance: number;
    remoteChannelBalance: number;
  };

  @ApiProperty()
  lnbits: {
    balance: number;
  };
}
