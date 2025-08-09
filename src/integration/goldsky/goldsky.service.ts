import { Injectable } from '@nestjs/common';
import { gql, request } from 'graphql-request';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export interface GoldskyTransfer {
  id: string;
  from: string;
  to: string;
  value: string;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
  gasUsed?: string;
  gasPrice?: string;
}

export interface GoldskyTokenTransfer extends GoldskyTransfer {
  contractAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimals?: number;
}

@Injectable()
export class GoldskyService {
  private readonly logger = new DfxLogger(GoldskyService);

  private getEndpoints() {
    return {
      'citrea-testnet': GetConfig().blockchain?.citreaTestnet?.goldskySubgraphUrl,
      'citrea-devnet': undefined, // Add when needed
    };
  }

  async getNativeCoinTransfers(
    network: 'citrea-testnet' | 'citrea-devnet',
    address: string,
    fromBlock: number,
    toBlock?: number,
  ): Promise<GoldskyTransfer[]> {
    const endpoint = this.getEndpoint(network);
    if (!endpoint) {
      this.logger.warn(`No Goldsky endpoint configured for ${network}`);
      return [];
    }

    const query = gql`
      query GetNativeTransfers($address: String!, $fromBlock: Int!, $toBlock: Int) {
        transfers(
          where: { or: [{ from: $address }, { to: $address }], blockNumber_gte: $fromBlock, blockNumber_lte: $toBlock }
          orderBy: blockNumber
          orderDirection: desc
          first: 1000
        ) {
          id
          from
          to
          value
          blockNumber
          blockTimestamp
          transactionHash
          gasUsed
          gasPrice
        }
      }
    `;

    try {
      const variables = {
        address: address.toLowerCase(),
        fromBlock,
        toBlock: toBlock || 999999999,
      };

      const data = await request<{ transfers: GoldskyTransfer[] }>(endpoint, query, variables);
      return data.transfers || [];
    } catch (error) {
      this.logger.error(`Failed to fetch native transfers from Goldsky for ${network}:`, error);
      return [];
    }
  }

  async getTokenTransfers(
    network: 'citrea-testnet' | 'citrea-devnet',
    address: string,
    fromBlock: number,
    toBlock?: number,
    contractAddress?: string,
  ): Promise<GoldskyTokenTransfer[]> {
    const endpoint = this.getEndpoint(network);
    if (!endpoint) {
      this.logger.warn(`No Goldsky endpoint configured for ${network}`);
      return [];
    }

    const query = gql`
      query GetTokenTransfers($address: String!, $fromBlock: Int!, $toBlock: Int, $contractAddress: String) {
        tokenTransfers(
          where: {
            or: [
              { from: $address }
              { to: $address }
            ]
            blockNumber_gte: $fromBlock
            blockNumber_lte: $toBlock
            ${contractAddress ? 'contractAddress: $contractAddress' : ''}
          }
          orderBy: blockNumber
          orderDirection: desc
          first: 1000
        ) {
          id
          from
          to
          value
          blockNumber
          blockTimestamp
          transactionHash
          contractAddress
          tokenSymbol
          tokenName
          tokenDecimals
          gasUsed
          gasPrice
        }
      }
    `;

    try {
      const variables: any = {
        address: address.toLowerCase(),
        fromBlock,
        toBlock: toBlock || 999999999,
      };

      if (contractAddress) {
        variables.contractAddress = contractAddress.toLowerCase();
      }

      const data = await request<{ tokenTransfers: GoldskyTokenTransfer[] }>(endpoint, query, variables);
      return data.tokenTransfers || [];
    } catch (error) {
      this.logger.error(`Failed to fetch token transfers from Goldsky for ${network}:`, error);
      return [];
    }
  }

  private getEndpoint(network: 'citrea-testnet' | 'citrea-devnet'): string | undefined {
    const endpoints = this.getEndpoints();
    const endpoint = endpoints[network];
    if (!endpoint) {
      return undefined;
    }
    return endpoint;
  }
}
