import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { IknaAddressNeighborInfo } from '../dto/ikna-address-neighbor.dto';
import { IknaAddressTag, IknaAddressTagResult } from '../dto/ikna-address-tag.dto';
import { IknaSanctionResult } from '../dto/ikna-sanction-result.dto';

export enum IknaBlockchain {
  BITCOIN = 'btc',
  ETHEREUM = 'eth',
  BINANCE_SMART_CHAIN = 'bsc',
  ARBITRUM = 'arb',
}

@Injectable()
export class IknaService {
  private readonly baseUrl = 'https://api.ikna.io';

  private sanctionResults: { [key: number]: IknaSanctionResult } = {};

  constructor(private readonly http: HttpService) {}

  async doAddressBFS(address: string, blockchain: IknaBlockchain, depth = 1): Promise<number> {
    const resultId = Util.randomId();
    this.sanctionResults[resultId] = { testedAddress: address, isSanctioned: null };
    void this.startAddressBFS(resultId, address, blockchain, depth);
    return resultId;
  }

  public getBfsResult(resultId: number): IknaSanctionResult {
    const sanctionResult = this.sanctionResults[resultId];
    if (!sanctionResult) throw new NotFoundException('BFS sanction result not found');
    if (sanctionResult.isSanctioned !== null) delete this.sanctionResults[resultId];

    return sanctionResult;
  }

  // --- BFS METHODS --- //

  private async bfsAddressLevel(
    address: string,
    blockchain: IknaBlockchain,
    depth: number,
  ): Promise<IknaSanctionResult | undefined> {
    try {
      const addressTags = await this.getAddressTags(address, blockchain);

      if (this.hasExchangeTag(addressTags)) return { isSanctioned: false, testedAddress: address };

      if (this.hasSanctionTag(addressTags))
        return {
          isSanctioned: true,
          testedAddress: address,
          sanctionedAddress: address,
          sanctionedAddressTags: addressTags,
        };

      if (depth < 1) return { isSanctioned: false, testedAddress: address };

      let neighborInfo: IknaAddressNeighborInfo;

      do {
        neighborInfo = await this.getAddressNeighbors(address, blockchain, neighborInfo?.next_page);

        for (const neighbor of neighborInfo?.neighbors ?? []) {
          const recursiveResult = await this.bfsAddressLevel(neighbor.address.address, blockchain, depth - 1);

          if (recursiveResult?.isSanctioned) return recursiveResult;
        }
      } while (neighborInfo?.next_page);

      return { isSanctioned: false, testedAddress: address };
    } catch (error) {
      throw new BadRequestException(`Failed Ikna bfs for ${address}:`, error.message);
    }
  }

  // TODO BFS Cluster Level
  //   async bfsClusterLevel() {}

  // --- IKNA METHODS --- //

  async getAddressNeighbors(
    address: string,
    blockchain: IknaBlockchain,
    nextPage?: string,
  ): Promise<IknaAddressNeighborInfo | undefined> {
    const url = `${this.baseUrl}/${blockchain}/addresses/${address}/neighbors`;

    return this.http.get<IknaAddressNeighborInfo>(url, {
      headers: Config.ikna,
      params: { direction: 'in', pagesize: '100', page: nextPage },
    });
  }

  async getAddressTags(address: string, blockchain: IknaBlockchain): Promise<IknaAddressTag[]> {
    const url = `${this.baseUrl}/${blockchain}/addresses/${address}/tags`;

    try {
      return (await this.http.get<IknaAddressTagResult>(url, { headers: Config.ikna }))?.address_tags;
    } catch (error) {
      throw new ServiceUnavailableException(`Failed to get IKNA address infos for ${address}:`, error);
    }
  }

  // --- HELPER METHODS --- //

  private async startAddressBFS(
    resultId: number,
    address: string,
    blockchain: IknaBlockchain,
    depth = 1,
  ): Promise<void> {
    const result = await this.bfsAddressLevel(address, blockchain, depth);
    this.sanctionResults[resultId] = result;
  }

  private hasSanctionTag(addressTags: IknaAddressTag[]): boolean {
    return addressTags.some(
      (addressTag) =>
        addressTag.label.includes('sanction') ||
        addressTag.tagpack_title.includes('sanction') ||
        addressTag.abuse?.includes('sanction'),
    );
  }

  private hasExchangeTag(addressTags: IknaAddressTag[]): boolean {
    return addressTags.some((addressTag) => addressTag.category?.includes('exchange'));
  }
}
