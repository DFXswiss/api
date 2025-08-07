import { Injectable } from '@nestjs/common';
import { request, gql } from 'graphql-request';
import { GetConfig } from 'src/config/config';

/**
 * IMPORTANT: This Goldsky integration requires a deployed subgraph to function.
 * 
 * Prerequisites:
 * 1. Deploy a Citrea subgraph to Goldsky with transfer entities
 * 2. Configure CITREA_TESTNET_GOLDSKY_SUBGRAPH_URL environment variable
 * 3. Ensure the subgraph schema matches the expected entity structure below
 * 
 * Without a deployed subgraph, all queries will return empty arrays.
 * 
 * To deploy a subgraph:
 * ```bash
 * goldsky subgraph deploy citrea-transfers/1.0.0 --from-abi ./abi.json --chain citrea-testnet
 * ```
 */

// Expected entity structure from the subgraph (must be verified against actual deployment)
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
      console.warn(`No Goldsky endpoint configured for ${network}`);
      return [];
    }

    // NOTE: This query assumes a specific subgraph schema with 'transfers' entity
    // The actual entity name and filter syntax must match the deployed subgraph
    const query = gql`
      query GetNativeTransfers($address: String!, $fromBlock: Int!, $toBlock: Int) {
        transfers(
          where: {
            or: [
              { from: $address }
              { to: $address }
            ]
            blockNumber_gte: $fromBlock
            blockNumber_lte: $toBlock
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
      console.error(`Failed to fetch native transfers from Goldsky for ${network}:`, error);
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
      console.warn(`No Goldsky endpoint configured for ${network}`);
      return [];
    }

    // NOTE: This query assumes a specific subgraph schema with 'tokenTransfers' entity
    // The actual entity name and filter syntax must match the deployed subgraph
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
      console.error(`Failed to fetch token transfers from Goldsky for ${network}:`, error);
      return [];
    }
  }

  private getEndpoint(network: 'citrea-testnet' | 'citrea-devnet'): string | undefined {
    const endpoints = this.getEndpoints();
    const endpoint = endpoints[network];
    if (!endpoint) {
      // Fallback to public endpoint if available
      // Format: https://api.goldsky.com/api/public/<project_id>/subgraphs/<name>/<version>/gn
      return undefined;
    }
    return endpoint;
  }
}