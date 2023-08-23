import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from '../utils/util';
import { HttpService } from './http.service';

export interface IknaAddressNeighborInfo {
  next_page: string;
  neighbors: IknaAddressNeighbor[];
}

interface IknaAddressNeighbor {
  address: {
    actors?: [{ id: string; label: string }];
    address: string;
    balance: IknaFiatValues;
    currency: string;
    entity: number;
    first_tx: {
      tx_hash: string;
      height: number;
      timestamp: number;
    };
    in_degree: number;
    is_contract?: boolean;
    last_tx: {
      tx_hash: string;
      height: number;
      timestamp: number;
    };
    no_incoming_txs: number;
    no_outgoing_txs: number;
    out_degree: number;
    status: IknaStatus;
    token_balances?: IknaBalance;
    total_received: IknaFiatValues;
    total_spent: IknaFiatValues;
    total_tokens_received?: IknaBalance;
    total_tokens_spent: IknaBalance;
  };
  labels?: string[];
  no_txs: number;
  token_values?: IknaBalance;
  value: IknaFiatValues;
}

export interface IknaAddressTagInfo {
  address_tags: IknaAddressTag[];
}

interface IknaAddressTag {
  abuse?: string;
  actor?: string;
  category?: string;
  confidence?: string;
  confidence_level?: number;
  currency: string;
  is_cluster_definer: boolean;
  label: string;
  lastmod?: number;
  source?: string;
  tagpack_creator: string;
  tagpack_is_public: boolean;
  tagpack_title: string;
  tagpack_uri?: string;
  address: string;
  entity: number;
}

interface IknaBalance {
  [key: string]: IknaFiatValues;
}

interface IknaFiatValues {
  fiat_values: { code: string; value: number };
  value: number;
}

enum IknaStatus {
  CLEAN = 'clean',
  DIRTY = 'dirty',
  NEW = 'new',
}

export enum IknaBlockchain {
  BITCOIN = 'btc',
  ETHEREUM = 'eth',
  BINANCE_SMART_CHAIN = 'bsc',
  ARBITRUM = 'arb',
}

export interface IknaSanctionResult {
  testedAddress: string;
  isSanctioned: boolean | null;
  sanctionedAddress?: string;
  sanctionedAddressTags?: IknaAddressTag[];
}

@Injectable()
export class IknaService {
  private readonly baseUrl = 'https://api.ikna.io';

  private sanctionResults: { [key: number]: IknaSanctionResult } = {};

  constructor(private readonly http: HttpService) {}

  async bfsClusterLevel() {}

  async doBFS(address: string, blockchain: IknaBlockchain, depth = 1): Promise<number> {
    const resultId = Util.randomId();
    this.saveBfsResult(resultId, address, blockchain, depth);
    return resultId;
  }

  public getBfsResult(resultId: number): IknaSanctionResult {
    const sanctionResult = this.sanctionResults[resultId];
    if (!sanctionResult) throw new NotFoundException('BFS sanction result not found');
    if (sanctionResult.isSanctioned !== null) delete this.sanctionResults[resultId];

    return sanctionResult;
  }

  private async saveBfsResult(resultId: number, address: string, blockchain: IknaBlockchain, depth = 1): Promise<void> {
    this.sanctionResults[resultId] = { testedAddress: address, isSanctioned: null };
    const result = await this.bfsAddressLevel(address, blockchain, depth);
    this.sanctionResults[resultId] = result;
  }

  private async bfsAddressLevel(
    address: string,
    blockchain: IknaBlockchain,
    depth: number,
  ): Promise<IknaSanctionResult> {
    if (depth < 0) return;

    try {
      const neighbors = await this.getAddressNeighbors(address, blockchain);

      for (const neighbor of neighbors) {
        const addressTag = await this.getAddressTags(neighbor.address.address, blockchain);

        if (this.hasSanctionTag(addressTag))
          return {
            isSanctioned: true,
            testedAddress: address,
            sanctionedAddress: neighbor.address.address,
            sanctionedAddressTags: addressTag,
          };

        const recursiveResult =
          depth - 1 > 0 && (await this.bfsAddressLevel(neighbor.address.address, blockchain, depth - 1));

        if (recursiveResult?.isSanctioned) return recursiveResult;
      }

      return { isSanctioned: false, testedAddress: address };
    } catch (error) {
      throw new BadRequestException(`Failed Ikna bfs for ${address}:`, error.message);
    }
  }

  private hasSanctionTag(addressTags: IknaAddressTag[]): boolean {
    return addressTags.some(
      (addressTag) =>
        addressTag.label.includes('sanction') ||
        addressTag.tagpack_title.includes('sanction') ||
        addressTag.abuse?.includes('sanction'),
    );
  }

  async getAddressNeighbors(address: string, blockchain: IknaBlockchain): Promise<IknaAddressNeighbor[] | undefined> {
    const url = `${this.baseUrl}/${blockchain}/addresses/${address}/neighbors?direction=in&pagesize=1000`;

    return (await this.http.get<IknaAddressNeighborInfo>(url, { headers: Config.ikna }))?.neighbors;
  }

  async getAddressTags(address: string, blockchain: IknaBlockchain): Promise<IknaAddressTag[]> {
    const url = `${this.baseUrl}/${blockchain}/addresses/${address}/tags`;

    try {
      return (await this.http.get<IknaAddressTagInfo>(url, { headers: Config.ikna }))?.address_tags;
    } catch (error) {
      throw new ServiceUnavailableException(`Failed to get IKNA address infos for ${address}:`, error);
    }
  }
}
