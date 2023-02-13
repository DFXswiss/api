import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetCryptoPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/crypto-route/dto/get-crypto-payment-info.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { AssetService } from '../models/asset/asset.service';
import { FiatService } from '../models/fiat/fiat.service';

@Injectable()
export class PaymentInfoService {
  constructor(private readonly fiatService: FiatService, private readonly assetService: AssetService) {}

  async buyCheck(dto: GetBuyPaymentInfoDto): Promise<GetBuyPaymentInfoDto> {
    dto.currency = await this.fiatService.getFiat(dto.currency.id);
    if (!dto.currency) throw new NotFoundException('Currency not found');
    if (!dto.currency.sellable) throw new BadRequestException('Currency not sellable');

    dto.asset = await this.assetService.getAssetById(dto.asset.id);
    if (!dto.asset) throw new NotFoundException('Asset not found');
    if (!dto.asset.buyable) throw new BadRequestException('Asset not buyable');

    return dto;
  }

  async sellCheck(dto: GetSellPaymentInfoDto): Promise<GetSellPaymentInfoDto> {
    dto.asset = await this.assetService.getAssetById(dto.asset.id);
    if (!dto.asset) throw new NotFoundException('Asset not found');
    if (!dto.asset.sellable) throw new BadRequestException('Asset not sellable');

    dto.currency = await this.fiatService.getFiat(dto.currency.id);
    if (!dto.currency) throw new NotFoundException('Currency not found');
    if (!dto.currency.buyable) throw new BadRequestException('Currency not buyable');

    return dto;
  }

  async cryptoCheck(dto: GetCryptoPaymentInfoDto): Promise<GetCryptoPaymentInfoDto> {
    dto.asset = await this.assetService.getAssetById(dto.asset.id);
    if (!dto.asset) throw new NotFoundException('Target asset not found');
    if (!dto.asset.buyable) throw new BadRequestException('Target asset not buyable');

    dto.sourceAsset = await this.assetService.getAssetById(dto.sourceAsset.id);
    if (!dto.sourceAsset) throw new NotFoundException('Source asset not found');
    if (!dto.sourceAsset.sellable) throw new BadRequestException('Source asset not sellable');

    return dto;
  }
}
