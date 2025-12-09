import {
  ADDRESS,
  DecentralizedEUROABI,
  DEPSWrapperABI,
  EquityABI,
  ERC20ABI,
  PositionV2ABI,
  StablecoinBridgeABI,
} from '@deuro/eurocoin';
import { Contract, ethers } from 'ethers';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import { EvmClient } from '../shared/evm/evm-client';
import { DEuroDepsGraphDto, DEuroPositionGraphDto, DEuroSavingsInfoDto } from './dto/deuro.dto';

interface GraphQLPageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string;
  endCursor: string;
}

export class DEuroClient {
  constructor(private readonly evmClient: EvmClient) {}

  async getPositionV2s(): Promise<DEuroPositionGraphDto[]> {
    let gqlResult = await request<{ positionV2s: { items: [DEuroPositionGraphDto]; pageInfo: GraphQLPageInfo } }>(
      Config.blockchain.deuro.graphUrl,
      gql`
        ${this.createGQLPositionV2s()}
      `,
    );

    const positionV2s: DEuroPositionGraphDto[] = gqlResult.positionV2s.items;

    while (gqlResult.positionV2s.pageInfo.hasNextPage) {
      gqlResult = await request<{ positionV2s: { items: [DEuroPositionGraphDto]; pageInfo: GraphQLPageInfo } }>(
        Config.blockchain.deuro.graphUrl,
        gql`
          ${this.createGQLPositionV2s(gqlResult.positionV2s.pageInfo.endCursor)}
        `,
      );

      positionV2s.push(...gqlResult.positionV2s.items);
    }

    return positionV2s;
  }

  private createGQLPositionV2s(after?: string): string {
    const gqlParams = after ? `(after: "${after}")` : '';

    return `{
        positionV2s${gqlParams} {
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
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }`;
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

  getWalletAddress(): string {
    return this.evmClient.wallet.address;
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

  getDEPSWrapperContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].DEPSwrapper, DEPSWrapperABI, this.evmClient.wallet);
  }

  getBridgeContracts(): Contract[] {
    return [
      this.getBridgeEURTContract(),
      this.getBridgeEURCContract(),
      this.getBridgeEURSContract(),
      this.getBridgeVEURContract(),
      this.getBridgeEURRContract(),
      this.getBridgeEUROPContract(),
      this.getBridgeEURIContract(),
      this.getBridgeEUREContract(),
      this.getBridgeEURAContract(),
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

  getBridgeEURRContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeEURR, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeEUROPContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeEUROP, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeEURIContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeEURI, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeEUREContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeEURE, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeEURAContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeEURA, StablecoinBridgeABI, this.evmClient.wallet);
  }

  async getBridgeEurcRemainingCapacity(): Promise<ethers.BigNumber> {
    const bridgeContract = this.getBridgeEURCContract();
    const limit = await bridgeContract.limit();
    const minted = await bridgeContract.minted();
    return limit.sub(minted);
  }

  async bridgeEurcToDeuro(amount: ethers.BigNumber): Promise<string> {
    const bridgeContract = this.getBridgeEURCContract();

    const remainingCapacity = await this.getBridgeEurcRemainingCapacity();
    if (remainingCapacity.lt(amount)) {
      throw new Error(
        `Bridge capacity exceeded (remaining: ${remainingCapacity.toString()}, requested: ${amount.toString()})`,
      );
    }

    const eurcAddress = await bridgeContract.eur();
    const eurcContract = this.getErc20Contract(eurcAddress);

    const allowance = await eurcContract.allowance(this.evmClient.wallet.address, bridgeContract.address);
    if (allowance.lt(amount)) {
      const approveTx = await eurcContract.approve(bridgeContract.address, ethers.constants.MaxUint256);
      await approveTx.wait();
    }

    const tx = await bridgeContract.mint(amount);
    return tx.hash;
  }
}
