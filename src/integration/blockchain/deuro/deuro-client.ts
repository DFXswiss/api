import {
  ADDRESS,
  DecentralizedEUROABI,
  EquityABI,
  ERC20ABI,
  PositionV2ABI,
  StablecoinBridgeABI,
} from '@deuro/eurocoin';
import { Contract } from 'ethers';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import { EvmClient } from '../shared/evm/evm-client';
import { DEuroDepsGraphDto, DEuroPositionGraphDto, DEuroSavingsInfoDto } from './dto/deuro.dto';

export class DEuroClient {
  constructor(private readonly evmClient: EvmClient) {}

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
            principal
            reserveContribution
            expiration
            closed
            denied
          }
        }
      }
    `;

    return request<{ positionV2s: { items: [DEuroPositionGraphDto] } }>(
      Config.blockchain.deuro.graphUrl,
      document,
    ).then((r) => r.positionV2s.items);
  }

  async getSavingsInfo(): Promise<DEuroSavingsInfoDto> {
    const url = `${Config.blockchain.deuro.apiUrl}/savings/core/info`;

    return this.evmClient.http.get<DEuroSavingsInfoDto>(url);
  }

  async getDEPS(): Promise<DEuroDepsGraphDto> {
    const address = ADDRESS[this.evmClient.chainId].decentralizedEURO;

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

    return request<{ dEPS: DEuroDepsGraphDto }>(Config.blockchain.deuro.graphUrl, document).then((r) => r.dEPS);
  }

  getDEuroContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].decentralizedEURO, DecentralizedEUROABI, this.evmClient.wallet);
  }

  getEquityContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].equity, EquityABI, this.evmClient.wallet);
  }

  getPositionContract(address: string): Contract {
    return new Contract(address, PositionV2ABI, this.evmClient.wallet);
  }

  getErc20Contract(address: string): Contract {
    return new Contract(address, ERC20ABI, this.evmClient.wallet);
  }

  getBridgeContracts(): Contract[] {
    return [
      this.getBridgeEURTContract(),
      this.getBridgeEURCContract(),
      this.getBridgeEURSContract(),
      this.getBridgeVEURContract(),
    ];
  }

  getBridgeEURTContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeEURT, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeEURCContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeEURC, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeEURSContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeEURS, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeVEURContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeVEUR, StablecoinBridgeABI, this.evmClient.wallet);
  }
}
