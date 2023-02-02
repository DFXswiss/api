import { IsEnum, IsNotEmpty, IsObject } from 'class-validator';
import { ethers } from 'ethers';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class EvmRawTransactionDto {
  @IsNotEmpty()
  @IsObject()
  request: ethers.providers.TransactionRequest;

  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;
}
