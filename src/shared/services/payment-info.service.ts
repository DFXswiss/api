import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GetCryptoPaymentInfoDto } from 'src/mix/models/crypto-route/dto/get-crypto-payment-info.dto';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/route/dto/get-buy-payment-info.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/sell/dto/get-sell-payment-info.dto';
import { AssetService } from '../models/asset/asset.service';
import { FiatService } from '../models/fiat/fiat.service';

@Injectable()
export class PaymentInfoService {
  constructor(private readonly fiatService: FiatService, private readonly assetService: AssetService) {}

  async buyPaymentInfoCheck(dto: GetBuyPaymentInfoDto): Promise<void> {
    dto.currency = await this.fiatService.getFiat(dto.currency.id);
    if (!dto.currency) throw new NotFoundException('Currency not found');
    if (!dto.currency.sellable) throw new BadRequestException('Currency not sellable');

    dto.asset = await this.assetService.getAssetById(dto.asset.id);
    if (!dto.asset) throw new NotFoundException('Asset not found');
    if (!dto.asset.buyable) throw new BadRequestException('Asset not buyable');
  }

  async sellPaymentInfoCheck(dto: GetSellPaymentInfoDto): Promise<void> {
    dto.asset = await this.assetService.getAssetById(dto.asset.id);
    if (!dto.asset) throw new NotFoundException('Asset not found');
    if (!dto.asset.sellable) throw new BadRequestException('Asset not sellable');

    dto.currency = await this.fiatService.getFiat(dto.currency.id);
    if (!dto.currency) throw new NotFoundException('Currency not found');
    if (!dto.currency.buyable) throw new BadRequestException('Currency not buyable');
  }

  async cryptoPaymentInfoCheck(dto: GetCryptoPaymentInfoDto): Promise<void> {
    dto.asset = await this.assetService.getAssetById(dto.asset.id);
    if (!dto.asset) throw new NotFoundException('Target asset not found');
    if (!dto.asset.buyable) throw new BadRequestException('Target asset not buyable');

    dto.sourceAsset = await this.assetService.getAssetById(dto.sourceAsset.id);
    if (!dto.sourceAsset) throw new NotFoundException('Source asset not found');
    if (!dto.sourceAsset.sellable) throw new BadRequestException('Source asset not sellable');
  }
}
