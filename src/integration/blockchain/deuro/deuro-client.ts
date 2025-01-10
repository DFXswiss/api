import { ADDRESS, DecentralizedEUROABI, EquityABI } from '@deuro/eurocoin';
import { Contract, ethers } from 'ethers';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { DEuroDepsGraphDto, DEuroPositionGraphDto } from './dto/deuro.dto';

export class DEuroClient {
  private readonly provider: ethers.providers.JsonRpcProvider;

  constructor(private readonly http: HttpService, gatewayUrl: string, apiKey: string) {
    const providerUrl = `${gatewayUrl}/${apiKey}`;
    this.provider = new ethers.providers.JsonRpcProvider(providerUrl);
  }

  async getTvl(): Promise<number> {
    return this.http.get<number>(`${Config.blockchain.deuro.deuroTvlUrl}`);
  }

  async getPositionV2s(): Promise<DEuroPositionGraphDto[]> {
    const document = gql`
      {
        positionV2s {
          items {
            id
            position
            owner
            deuro
            collateral
            price
            collateralSymbol
            collateralBalance
            collateralDecimals
            limitForClones
            availableForClones
            minted
            reserveContribution
            expiration
          }
        }
      }
    `;

    return request<{ positionV2s: { items: [DEuroPositionGraphDto] } }>(
      Config.blockchain.deuro.deuroGraphUrl,
      document,
    ).then((r) => r.positionV2s.items);
  }

  async getDEPS(chainId: number): Promise<DEuroDepsGraphDto> {
    const address = ADDRESS[chainId].decentralizedEURO;

    const document = gql`
      {
        dEPS(id: "${address}") {
          id
          profits
          loss
          reserve
        }
      }
    `;

    return request<{ dEPS: DEuroDepsGraphDto }>(Config.blockchain.deuro.deuroGraphUrl, document).then((r) => r.dEPS);
  }

  getDEuroContract(chainId: number): Contract {
    return new Contract(ADDRESS[chainId].decentralizedEURO, DecentralizedEUROABI, this.provider);
  }

  getEquityContract(chainId: number): Contract {
    return new Contract(ADDRESS[chainId].equity, EquityABI, this.provider);
  }
}
