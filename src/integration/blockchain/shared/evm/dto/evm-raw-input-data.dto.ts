import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class EvmRawInputDataDto {
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @IsNotEmpty()
  @IsString()
  contractAddress: string;

  @IsNotEmpty()
  @IsString()
  signer: string;

  @IsNotEmpty()
  @IsString()
  callData: string;
}
