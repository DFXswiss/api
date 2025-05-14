import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class CreateTatumWebhookDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty()
  @IsNotEmpty()
  addresses: string[];
}

export interface TatumWebhookDto {
  address: string;
  amount: string;
  counterAddresses: string[];
  asset: string;
  type: string;
  blockNumber: number;
  txId: string;
  addressesRiskRatio: any[];
  subscriptionId: string;
  subscriptionType: string;
  chain: string;
}
