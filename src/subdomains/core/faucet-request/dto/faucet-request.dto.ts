import { ApiProperty } from '@nestjs/swagger';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';

export class FaucetRequestDto {
  @ApiProperty({ description: 'Transaction ID of faucet transaction' })
  txId: string;

  @ApiProperty({ description: 'Transaction amount of faucet transaction' })
  amount: number;

  @ApiProperty({ description: 'Asset of faucet transaction', type: AssetDto })
  asset: AssetDto;
}
