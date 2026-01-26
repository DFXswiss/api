import { Injectable } from '@nestjs/common';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import { GoldskyNetwork } from './goldsky.types';

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
  private getEndpoints(): Record<GoldskyNetwork, string | undefined> {
    return {
      [GoldskyNetwork.CITREA_TESTNET]: Config.blockchain.citreaTestnet.goldskySubgraphUrl,
      [GoldskyNetwork.CITREA_DEVNET]: undefined,
      [GoldskyNetwork.CITREA]: Config.blockchain.citrea.goldskySubgraphUrl,
    };
  }

  async getNativeCoinTransfers(
    network: GoldskyNetwork,
    address: string,
    fromBlock: number,
    toBlock?: number,
  ): Promise<GoldskyTransfer[]> {
    const endpoint = this.getEndpoint(network);

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

    const variables = {
      address: address.toLowerCase(),
      fromBlock,
      toBlock: toBlock || 999999999,
    };

    const data = await request<{ transfers: GoldskyTransfer[] }>(endpoint, query, variables);
    return data.transfers || [];
  }

  async getTokenTransfers(
    network: GoldskyNetwork,
    address: string,
    fromBlock: number,
    toBlock?: number,
    contractAddress?: string,
  ): Promise<GoldskyTokenTransfer[]> {
    const endpoint = this.getEndpoint(network);

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
  }

  private getEndpoint(network: GoldskyNetwork): string {
    const endpoint = this.getEndpoints()[network];
    if (!endpoint) throw new Error(`No Goldsky endpoint configured for ${network}`);

    return endpoint;
  }
}
