import { BadRequestException, Injectable } from '@nestjs/common';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { TronService } from 'src/integration/blockchain/tron/services/tron.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BalanceDto, GetBalancesDto, GetBalancesResponseDto } from '../dto/get-balances.dto';

@Injectable()
export class BlockchainBalanceService {
  constructor(
    private readonly alchemyService: AlchemyService,
    private readonly solanaService: SolanaService,
    private readonly tronService: TronService,
    private readonly assetService: AssetService,
  ) {}

  async getBalances(dto: GetBalancesDto): Promise<GetBalancesResponseDto> {
    const { address, blockchain, assetIds } = dto;

    const assets = assetIds?.length
      ? await this.assetService.getAssetsById(assetIds)
      : await this.assetService.getAllBlockchainAssets([blockchain]);

    const filteredAssets = assets.filter((a) => a.blockchain === blockchain);

    if (filteredAssets.length === 0) {
      return { balances: [] };
    }

    if (blockchain === Blockchain.SOLANA) {
      return this.getSolanaBalances(address, filteredAssets);
    }

    if (blockchain === Blockchain.TRON) {
      return this.getTronBalances(address, filteredAssets);
    }

    if (AlchemyNetworkMapper.availableNetworks.includes(blockchain)) {
      return this.getEvmBalances(address, blockchain, filteredAssets);
    }

    throw new BadRequestException(`Blockchain ${blockchain} is not supported for balance queries`);
  }

  private async getSolanaBalances(address: string, assets: Asset[]): Promise<GetBalancesResponseDto> {
    const balances: BalanceDto[] = [];

    const nativeAsset = assets.find((a) => a.type === AssetType.COIN);
    const tokenAssets = assets.filter((a) => a.type === AssetType.TOKEN && a.chainId);

    if (nativeAsset) {
      const nativeBalance = await this.solanaService.getNativeCoinBalanceForAddress(address);
      balances.push({
        assetId: nativeAsset.id,
        chainId: nativeAsset.chainId,
        balance: nativeBalance,
      });
    }

    for (const asset of tokenAssets) {
      const tokenBalance = await this.solanaService.getTokenBalance(asset, address);
      balances.push({
        assetId: asset.id,
        chainId: asset.chainId,
        balance: tokenBalance,
      });
    }

    return { balances };
  }

  private async getTronBalances(address: string, assets: Asset[]): Promise<GetBalancesResponseDto> {
    const balances: BalanceDto[] = [];

    const nativeAsset = assets.find((a) => a.type === AssetType.COIN);
    const tokenAssets = assets.filter((a) => a.type === AssetType.TOKEN && a.chainId);

    if (nativeAsset) {
      const nativeBalance = await this.tronService.getNativeCoinBalanceForAddress(address);
      balances.push({
        assetId: nativeAsset.id,
        chainId: nativeAsset.chainId,
        balance: nativeBalance,
      });
    }

    for (const asset of tokenAssets) {
      const tokenBalance = await this.tronService.getTokenBalance(asset, address);
      balances.push({
        assetId: asset.id,
        chainId: asset.chainId,
        balance: tokenBalance,
      });
    }

    return { balances };
  }

  private async getEvmBalances(
    address: string,
    blockchain: Blockchain,
    assets: Asset[],
  ): Promise<GetBalancesResponseDto> {
    const balances: BalanceDto[] = [];
    const chainId = EvmUtil.getChainId(blockchain);

    if (!chainId) {
      throw new BadRequestException(`Chain ID not found for blockchain ${blockchain}`);
    }

    const nativeAsset = assets.find((a) => a.type === AssetType.COIN);
    const tokenAssets = assets.filter((a) => a.type === AssetType.TOKEN && a.chainId);

    if (nativeAsset) {
      const nativeBalanceRaw = await this.alchemyService.getNativeCoinBalance(chainId, address);
      const nativeBalance = EvmUtil.fromWeiAmount(nativeBalanceRaw.toString(), 18);
      balances.push({
        assetId: nativeAsset.id,
        chainId: nativeAsset.chainId,
        balance: nativeBalance,
      });
    }

    if (tokenAssets.length > 0) {
      const tokenBalancesRaw = await this.alchemyService.getTokenBalances(chainId, address, tokenAssets);

      for (const asset of tokenAssets) {
        const tokenBalanceRaw = tokenBalancesRaw.find(
          (tb) => tb.contractAddress.toLowerCase() === asset.chainId?.toLowerCase(),
        );
        const balance = tokenBalanceRaw?.tokenBalance
          ? EvmUtil.fromWeiAmount(tokenBalanceRaw.tokenBalance, asset.decimals ?? 18)
          : 0;

        balances.push({
          assetId: asset.id,
          chainId: asset.chainId,
          balance,
        });
      }
    }

    return { balances };
  }
}
