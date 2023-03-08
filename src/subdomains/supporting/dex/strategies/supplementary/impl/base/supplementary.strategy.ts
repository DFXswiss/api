import { TransactionQuery, TransactionResult, TransferRequest } from 'src/subdomains/supporting/dex/interfaces';

export abstract class SupplementaryStrategy {
  abstract transferLiquidity(request: TransferRequest): Promise<string>;
  abstract transferMinimalCoin(address: string): Promise<string>;
  abstract checkTransferCompletion(transferTxId: string): Promise<boolean>;
  abstract findTransaction(query: TransactionQuery): Promise<TransactionResult>;
}
