import { AmlCheck } from '../../buy-crypto/enums/aml-check.enum';

export class BuyHistoryDto {
  inputAmount: number;
  inputAsset: string;
  outputAmount: number;
  outputAsset: string;
  txId: string;
  date: string;
  amlCheck: AmlCheck;
  isComplete: boolean;
}
