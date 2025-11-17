import { ApiProperty } from '@nestjs/swagger';
import { Asset } from 'src/shared/models/asset/asset.entity';

export class GetFaucetDto {
  @ApiProperty({ description: 'Faucet asset' })
  asset: Asset;
}

export class FaucetDto {
  @ApiProperty({ description: 'TX ID of faucet transaction' })
  txId: string;

  @ApiProperty({ description: 'TX amount of faucet transaction' })
  amount: number;
}
