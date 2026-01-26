import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export interface BlockscoutTransaction {
  hash: string;
  block_number: number;
  timestamp: string;
  from: { hash: string };
  to: { hash: string } | null;
  value: string;
  status: string;
}

export interface BlockscoutTokenTransfer {
  tx_hash: string;
  block_number: number;
  timestamp: string;
  from: { hash: string };
  to: { hash: string };
  token: {
    address: string;
    symbol: string;
    name: string;
    decimals: string;
  };
  total: {
    value: string;
    decimals: string;
  };
}

interface BlockscoutResponse<T> {
  items: T[];
  next_page_params: { block_number: number; index: number } | null;
}

@Injectable()
export class BlockscoutService {
  private readonly logger = new DfxLogger(BlockscoutService);

  constructor(private readonly http: HttpService) {}

  async getTransactions(
    apiUrl: string,
    address: string,
    fromBlock?: number,
  ): Promise<BlockscoutTransaction[]> {
    const allTransactions: BlockscoutTransaction[] = [];
    let nextPageParams: { block_number: number; index: number } | null = null;

    do {
      const params: Record<string, string> = { filter: 'to' };
      if (nextPageParams) {
        params.block_number = nextPageParams.block_number.toString();
        params.index = nextPageParams.index.toString();
      }

      const response = await this.http.get<BlockscoutResponse<BlockscoutTransaction>>(
        `${apiUrl}/api/v2/addresses/${address}/transactions`,
        { params },
      );

      const transactions = response.items || [];

      // Filter by fromBlock if specified
      const filtered = fromBlock
        ? transactions.filter((tx) => tx.block_number >= fromBlock)
        : transactions;

      allTransactions.push(...filtered);

      // Stop if we've gone past the fromBlock or no more pages
      if (fromBlock && transactions.some((tx) => tx.block_number < fromBlock)) {
        break;
      }

      nextPageParams = response.next_page_params;
    } while (nextPageParams);

    return allTransactions;
  }

  async getTokenTransfers(
    apiUrl: string,
    address: string,
    fromBlock?: number,
  ): Promise<BlockscoutTokenTransfer[]> {
    const allTransfers: BlockscoutTokenTransfer[] = [];
    let nextPageParams: { block_number: number; index: number } | null = null;

    do {
      const params: Record<string, string> = { filter: 'to', type: 'ERC-20' };
      if (nextPageParams) {
        params.block_number = nextPageParams.block_number.toString();
        params.index = nextPageParams.index.toString();
      }

      const response = await this.http.get<BlockscoutResponse<BlockscoutTokenTransfer>>(
        `${apiUrl}/api/v2/addresses/${address}/token-transfers`,
        { params },
      );

      const transfers = response.items || [];

      // Filter by fromBlock if specified
      const filtered = fromBlock ? transfers.filter((tx) => tx.block_number >= fromBlock) : transfers;

      allTransfers.push(...filtered);

      // Stop if we've gone past the fromBlock or no more pages
      if (fromBlock && transfers.some((tx) => tx.block_number < fromBlock)) {
        break;
      }

      nextPageParams = response.next_page_params;
    } while (nextPageParams);

    return allTransfers;
  }
}
