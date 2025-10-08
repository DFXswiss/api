import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { WalletAppDto, WalletAppQueryDto } from '../dto/wallet-app.dto';
import { WalletApp } from '../entities/wallet-app.entity';
import { WalletAppService } from '../services/wallet-app.service';

@ApiTags('Payment Link')
@Controller('paymentLink/walletApp')
export class WalletAppController {
  constructor(private readonly walletAppService: WalletAppService, private readonly assetService: AssetService) {}

  @Get()
  @ApiOkResponse({ type: WalletAppDto, isArray: true })
  async getAll(@Query() { blockchain, active }: WalletAppQueryDto): Promise<WalletAppDto[]> {
    return this.walletAppService
      .getAllBlockchainWalletApps(blockchain as Blockchain, active !== 'false')
      .then((l) => this.toDtoList(l));
  }

  @Get('recommended')
  @ApiOkResponse({ type: WalletAppDto, isArray: true })
  async getRecommended(): Promise<WalletAppDto[]> {
    return this.walletAppService.getRecommendedWalletApps().then((l) => this.toDtoList(l));
  }

  @Get(':id')
  @ApiOkResponse({ type: WalletAppDto })
  async getById(@Param('id') id: string): Promise<WalletAppDto> {
    return this.walletAppService.getWalletAppById(+id).then((l) => this.toDto(l));
  }

  // --- DTO --- //
  private async toDtoList(walletApps: WalletApp[]): Promise<WalletAppDto[]> {
    return Promise.all(walletApps.map((b) => this.toDto(b)));
  }

  private async toDto(walletApp: WalletApp): Promise<WalletAppDto> {
    const supportAssets = walletApp.supportedAssetList.length
      ? await this.assetService.getAssetsById(walletApp.supportedAssetList)
      : undefined;

    return {
      id: walletApp.id,
      name: walletApp.name,
      websiteUrl: walletApp.websiteUrl,
      iconUrl: walletApp.iconUrl,
      deepLink: walletApp.deepLink,
      hasActionDeepLink: walletApp.hasActionDeepLink,
      appStoreUrl: walletApp.appStoreUrl,
      playStoreUrl: walletApp.playStoreUrl,
      recommended: walletApp.recommended,
      supportedBlockchains: walletApp.supportedBlockchainList,
      supportedAssets: supportAssets?.map((a) => AssetDtoMapper.toDto(a)),
      semiCompatible: walletApp.semiCompatible,
      active: walletApp.active,
    };
  }
}
