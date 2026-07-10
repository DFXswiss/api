import { ADDRESS, EquityABI, ERC20ABI, JuiceDollarABI, PositionV2ABI, StablecoinBridgeABI } from '@juicedollar/jusd';
import { Contract, ethers } from 'ethers';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { EvmClient } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { JuiceEquityGraphDto, JuicePositionGraphDto, JuiceSavingsInfoDto } from './dto/juice.dto';

interface GraphQLPageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string;
  endCursor: string;
}

const positionV2sQuery = gql`
  query PositionV2s($after: String) {
    positionV2s(after: $after) {
      items {
        id
        position
        owner
        stablecoinAddress
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
  }
`;

const poolShareQuery = gql`
  query PoolShare($id: String!) {
    poolShare(id: $id) {
      id
      profits
      loss
      reserve
    }
  }
`;

export class JuiceClient {
  private readonly logger = new DfxLogger(JuiceClient);

  constructor(private readonly evmClient: EvmClient) {}

  async getPositionV2s(): Promise<JuicePositionGraphDto[]> {
    const graphUrl = Config.blockchain.juice.graphUrl;
    if (!graphUrl) return [];

    const positionV2s: JuicePositionGraphDto[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    const MAX_PAGES = 100;

    for (let page = 0; page < MAX_PAGES; page++) {
      const gqlResult = await request<{
        positionV2s: { items: [JuicePositionGraphDto]; pageInfo: GraphQLPageInfo };
      }>(graphUrl, positionV2sQuery, { after });

      positionV2s.push(...gqlResult.positionV2s.items);

      const { hasNextPage, endCursor } = gqlResult.positionV2s.pageInfo;
      if (!hasNextPage || !endCursor || seen.has(endCursor)) return positionV2s;

      seen.add(endCursor);
      after = endCursor;
    }

    this.logger.warn(`getPositionV2s reached the ${MAX_PAGES}-page limit; result may be incomplete`);
    return positionV2s;
  }

  async getSavingsInfo(): Promise<JuiceSavingsInfoDto> {
    const url = `${Config.blockchain.juice.apiUrl}/savings/core/info`;
    return this.evmClient.http.get<JuiceSavingsInfoDto>(url);
  }

  async getJuice(): Promise<JuiceEquityGraphDto> {
    const graphUrl = Config.blockchain.juice.graphUrl;
    if (!graphUrl) return null;

    const address = ADDRESS[this.evmClient.chainId].juiceDollar;

    return request<{ poolShare: JuiceEquityGraphDto }>(graphUrl, poolShareQuery, { id: address }).then(
      (r) => r.poolShare,
    );
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
      case 'USDT.e':
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
