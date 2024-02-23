import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateBuyDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/create-buy.dto';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetBuyQuoteDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-quote.dto';
import { CreateCryptoRouteDto } from 'src/subdomains/core/buy-crypto/routes/crypto-route/dto/create-crypto-route.dto';
import { GetCryptoPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/crypto-route/dto/get-crypto-payment-info.dto';
import { GetCryptoQuoteDto } from 'src/subdomains/core/buy-crypto/routes/crypto-route/dto/get-crypto-quote.dto';
import { CreateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/create-sell.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { GetSellQuoteDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-quote.dto';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { AssetService } from '../models/asset/asset.service';
import { FiatService } from '../models/fiat/fiat.service';

@Injectable()
export class PaymentInfoService {
  constructor(private readonly fiatService: FiatService, private readonly assetService: AssetService) {}

  async buyCheck<T extends GetBuyPaymentInfoDto | GetBuyQuoteDto | CreateBuyDto>(dto: T, jwt?: JwtPayload): Promise<T> {
    if ('currency' in dto) {
      dto.currency = await this.fiatService.getFiat(dto.currency.id);
      if (!dto.currency) throw new NotFoundException('Currency not found');
    }

    dto.asset = await this.assetService.getAssetById(dto.asset.id);
    if (!dto.asset) throw new NotFoundException('Asset not found');
    if (jwt && !jwt.blockchains.includes(dto.asset.blockchain))
      throw new BadRequestException('Asset blockchain mismatch');

    if ('paymentMethod' in dto && dto.paymentMethod === FiatPaymentMethod.CARD) {
      if (!dto.currency.cardSellable) throw new BadRequestException('Currency not sellable via Card');
      if (!dto.asset.cardBuyable) throw new BadRequestException('Asset not buyable via Card');
    } else if ('paymentMethod' in dto && dto.paymentMethod === FiatPaymentMethod.INSTANT) {
      if (!dto.currency.instantSellable) throw new BadRequestException('Currency not sellable via Instant');
      if (!dto.asset.instantBuyable) throw new BadRequestException('Asset not buyable via Instant');
    } else {
      if ('currency' in dto && !dto.currency.sellable) throw new BadRequestException('Currency not sellable via Bank');
      if (!dto.asset.buyable)
        throw new BadRequestException(`Asset not buyable ${'paymentMethod' in dto ? 'via Bank' : ''}`);
    }

    return dto;
  }

  async sellCheck<T extends GetSellPaymentInfoDto | GetSellQuoteDto | CreateSellDto>(
    dto: T,
    jwt?: JwtPayload,
  ): Promise<T> {
    if ('asset' in dto) {
      dto.asset = await this.assetService.getAssetById(dto.asset.id);
      if (!dto.asset) throw new NotFoundException('Asset not found');
      if (!dto.asset.sellable) throw new BadRequestException('Asset not sellable');
      if (jwt && !jwt.blockchains.includes(dto.asset.blockchain))
        throw new BadRequestException('Asset blockchain mismatch');
    }

    if ('iban' in dto && dto.currency?.name === 'CHF' && !dto.iban.startsWith('CH') && !dto.iban.startsWith('LI'))
      throw new BadRequestException(
        'CHF transactions are only permitted to Liechtenstein or Switzerland. Use EUR for other countries.',
      );

    if ('blockchain' in dto) {
      if (jwt && !jwt.blockchains.includes(dto.blockchain)) throw new BadRequestException('Asset blockchain mismatch');
    }

    dto.currency = await this.fiatService.getFiat(dto.currency.id);
    if (!dto.currency) throw new NotFoundException('Currency not found');
    if (!dto.currency.buyable) throw new BadRequestException('Currency not buyable');

    return dto;
  }

  async cryptoCheck<T extends GetCryptoPaymentInfoDto | GetCryptoQuoteDto | CreateCryptoRouteDto>(
    dto: T,
    jwt?: JwtPayload,
  ): Promise<T> {
    if ('sourceAsset' in dto) {
      dto.sourceAsset = await this.assetService.getAssetById(dto.sourceAsset.id);
      if (!dto.sourceAsset) throw new NotFoundException('Source asset not found');
      if (!dto.sourceAsset.sellable) throw new BadRequestException('Source asset not sellable');
    }

    dto.targetAsset = await this.assetService.getAssetById(dto.targetAsset.id);
    if (!dto.targetAsset) throw new NotFoundException('Asset not found');
    if (!dto.targetAsset.buyable) throw new BadRequestException('Asset not buyable');
    if (jwt && !jwt.blockchains.includes(dto.targetAsset.blockchain))
      throw new BadRequestException('Asset blockchain mismatch');

    return dto;
  }
}
