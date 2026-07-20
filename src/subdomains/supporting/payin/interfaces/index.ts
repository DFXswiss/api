import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInType } from '../entities/crypto-input.entity';

export interface PayInEntry {
  senderAddresses: string;
  receiverAddress: BlockchainAddress;
  txId: string;
  txType: PayInType | null;
  txSequence?: number;
  blockHeight: number | null;
  amount: number;
  // EXACT integer base units (wei/satoshi) of `amount`, captured from the on-chain raw value BEFORE `amount` is
  // float-collapsed (issue #4287 stage 1). A decimal integer STRING so it survives serialization and never loses
  // precision. Optional: a chain with no raw integer available leaves it undefined → the ledger derives from the
  // float `amount` as before (fail-open).
  amountBaseUnits?: string;
  asset: Asset | null;
}

export class PollAddressDto {
  @IsNotEmpty()
  @IsString()
  address: string;

  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @IsOptional()
  @IsNumber()
  fromBlock?: number;

  @IsOptional()
  @IsNumber()
  toBlock?: number;
}
