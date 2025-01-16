import { ADDRESS, DecentralizedEUROABI, EquityABI } from '@deuro/eurocoin';
import { Contract } from 'ethers';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import { DEuroDepsGraphDto, DEuroPositionGraphDto } from './dto/deuro.dto';

export class DEuroClient extends EvmClient {
  constructor(params: EvmClientParams) {
    super(params);
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
            closed
            denied
          }
        }
      }
    `;

    return request<{ positionV2s: { items: [DEuroPositionGraphDto] } }>(
      Config.blockchain.deuro.deuroGraphUrl,
      document,
    ).then((r) => r.positionV2s.items);
  }

  async getDEPS(): Promise<DEuroDepsGraphDto> {
    const address = ADDRESS[this.chainId].decentralizedEURO;

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

  getDEuroContract(): Contract {
    return new Contract(ADDRESS[this.chainId].decentralizedEURO, DecentralizedEUROABI, this.wallet);
  }

  getEquityContract(): Contract {
    return new Contract(ADDRESS[this.chainId].equity, EquityABI, this.wallet);
  }
}
