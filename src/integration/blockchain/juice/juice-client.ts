import { ADDRESS, EquityABI, ERC20ABI, JuiceDollarABI, PositionV2ABI, StablecoinBridgeABI } from '@juicedollar/jusd';
import { Contract, ethers } from 'ethers';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { EvmClient } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { JuiceEquityGraphDto, JuicePositionGraphDto, JuiceSavingsInfoDto } from './dto/juice.dto';

interface GraphQLPageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string;
  endCursor: string;
}

export class JuiceClient {
  constructor(private readonly evmClient: EvmClient) {}

  async getPositionV2s(): Promise<JuicePositionGraphDto[]> {
    const graphUrl = Config.blockchain.juice.graphUrl;
    if (!graphUrl) return [];

    let gqlResult = await request<{ positionV2s: { items: [JuicePositionGraphDto]; pageInfo: GraphQLPageInfo } }>(
      graphUrl,
      gql`
        ${this.createGQLPositionV2s()}
      `,
    );

    const positionV2s: JuicePositionGraphDto[] = gqlResult.positionV2s.items;

    while (gqlResult.positionV2s.pageInfo.hasNextPage) {
      gqlResult = await request<{ positionV2s: { items: [JuicePositionGraphDto]; pageInfo: GraphQLPageInfo } }>(
        graphUrl,
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
            jusd
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

  async getSavingsInfo(): Promise<JuiceSavingsInfoDto> {
    const apiUrl = Config.blockchain.juice.apiUrl;
    if (!apiUrl) {
      return {
        totalSaved: 0,
        totalWithdrawn: 0,
        totalBalance: 0,
        totalInterest: 0,
        rate: 0,
        ratioOfSupply: 0,
      };
    }

    const url = `${apiUrl}/savings/core/info`;
    return this.evmClient.http.get<JuiceSavingsInfoDto>(url);
  }

  async getJuice(): Promise<JuiceEquityGraphDto> {
    const graphUrl = Config.blockchain.juice.graphUrl;
    if (!graphUrl) return null;

    const address = ADDRESS[this.evmClient.chainId].juiceDollar;

    const document = gql`
      {
        jUICE(id: "${address}") {
          id
          profits
          loss
          reserve
        }
      }
    `;

    return request<{ jUICE: JuiceEquityGraphDto }>(graphUrl, document).then((r) => r.jUICE);
  }

  getWalletAddress(): string {
    return this.evmClient.wallet.address;
  }

  getJusdContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].juiceDollar, JuiceDollarABI, this.evmClient.wallet);
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
    const contracts: Contract[] = [this.getBridgeStartUSDContract()];

    const addresses = ADDRESS[this.evmClient.chainId];
    if (addresses.bridgeUSDC) contracts.push(this.getBridgeUSDCContract());
    if (addresses.bridgeUSDT) contracts.push(this.getBridgeUSDTContract());
    if (addresses.bridgeCTUSD) contracts.push(this.getBridgeCTUSDContract());

    return contracts;
  }

  getBridgeContract(assetName: string): Contract {
    switch (assetName) {
      case 'StartUSD':
        return this.getBridgeStartUSDContract();
      case 'USDC':
        return this.getBridgeUSDCContract();
      case 'USDT':
        return this.getBridgeUSDTContract();
      case 'CTUSD':
        return this.getBridgeCTUSDContract();
      default:
        throw new Error(`No bridge contract found for asset: ${assetName}`);
    }
  }

  getBridgeStartUSDContract(): Contract {
    return new Contract(ADDRESS[this.evmClient.chainId].bridgeStartUSD, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeUSDCContract(): Contract {
    const address = ADDRESS[this.evmClient.chainId].bridgeUSDC;
    if (!address) throw new Error('USDC bridge not available on this chain');
    return new Contract(address, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeUSDTContract(): Contract {
    const address = ADDRESS[this.evmClient.chainId].bridgeUSDT;
    if (!address) throw new Error('USDT bridge not available on this chain');
    return new Contract(address, StablecoinBridgeABI, this.evmClient.wallet);
  }

  getBridgeCTUSDContract(): Contract {
    const address = ADDRESS[this.evmClient.chainId].bridgeCTUSD;
    if (!address) throw new Error('CTUSD bridge not available on this chain');
    return new Contract(address, StablecoinBridgeABI, this.evmClient.wallet);
  }

  async bridgeToJusd(asset: Asset, amount: number): Promise<string> {
    const bridgeContract = this.getBridgeContract(asset.name);

    if (!asset.decimals) throw new Error(`Asset ${asset.name} has no decimals`);
    if (!asset.chainId) throw new Error(`Asset ${asset.name} has no chainId`);

    const remainingCapacity = await this.getBridgeRemainingCapacity(asset.name);
    if (remainingCapacity < amount) {
      throw new Error(
        `Bridge capacity exceeded for ${asset.name} (remaining: ${remainingCapacity} JUSD, requested: ${amount} ${asset.name})`,
      );
    }

    const weiAmount = EvmUtil.toWeiAmount(amount, asset.decimals);
    const eurTokenContract = this.getErc20Contract(asset.chainId);

    const allowance = await eurTokenContract.allowance(this.evmClient.wallet.address, bridgeContract.address);
    if (allowance.lt(weiAmount)) {
      const approveTx = await eurTokenContract.approve(bridgeContract.address, ethers.constants.MaxUint256);
      await approveTx.wait();
    }

    const tx = await bridgeContract.mint(weiAmount);
    return tx.hash;
  }

  private async getBridgeRemainingCapacity(assetName: string): Promise<number> {
    const bridgeContract = this.getBridgeContract(assetName);
    const limit = await bridgeContract.limit();
    const minted = await bridgeContract.minted();
    return EvmUtil.fromWeiAmount(limit.sub(minted), 18); // bridge capacity is in JUSD = 18 decimals
  }
}
