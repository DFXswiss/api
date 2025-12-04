import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateBuyDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/create-buy.dto';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { GetBuyQuoteDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-quote.dto';
import { CreateSwapDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/create-swap.dto';
import { GetSwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-payment-info.dto';
import { GetSwapQuoteDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/get-swap-quote.dto';
import { NoSwapBlockchains } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { CreateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/create-sell.dto';
import { GetSellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-payment-info.dto';
import { GetSellQuoteDto } from 'src/subdomains/core/sell-crypto/route/dto/get-sell-quote.dto';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { Asset } from '../models/asset/asset.entity';
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

    dto.asset = await this.resolveAsset(dto.asset);
    if (!dto.asset) throw new NotFoundException('Asset not found');
    if (jwt && !dto.asset.isBuyableOn(jwt.blockchains)) throw new BadRequestException('Asset blockchain mismatch');

    // Credit card payments disabled
    if ('paymentMethod' in dto && dto.paymentMethod === FiatPaymentMethod.CARD) {
      throw new BadRequestException('Credit card payments are currently disabled');
    }

    if ('paymentMethod' in dto && dto.paymentMethod === FiatPaymentMethod.INSTANT) {
      if (!dto.currency.instantSellable) throw new BadRequestException('Currency not sellable via Instant');
      if (!dto.asset.instantBuyable) throw new BadRequestException('Asset not buyable via Instant');
    } else {
      if ('currency' in dto && !dto.currency.sellable) throw new BadRequestException('Currency not sellable via Bank');
      if (!dto.asset.buyable)
        throw new BadRequestException(`Asset not buyable ${'paymentMethod' in dto ? 'via Bank' : ''}`);
    }

    if ('discountCode' in dto) dto.specialCode = dto.discountCode;

    return dto;
  }

  async sellCheck<T extends GetSellPaymentInfoDto | GetSellQuoteDto | CreateSellDto>(
    dto: T,
    jwt?: JwtPayload,
  ): Promise<T> {
    if ('asset' in dto) {
      dto.asset = await this.resolveAsset(dto.asset);
      if (!dto.asset) throw new NotFoundException('Asset not found');
      if (!dto.asset.sellable) throw new BadRequestException('Asset not sellable');
      if (jwt && !dto.asset.isBuyableOn(jwt.blockchains)) throw new BadRequestException('Asset blockchain mismatch');
    }

    if ('blockchain' in dto) {
      if (jwt && !jwt.blockchains.includes(dto.blockchain)) throw new BadRequestException('Asset blockchain mismatch');
    }

    dto.currency = await this.fiatService.getFiat(dto.currency.id);
    if (!dto.currency) throw new NotFoundException('Currency not found');
    if (!dto.currency.buyable) throw new BadRequestException('Currency not buyable');

    if ('iban' in dto && dto.currency?.name === 'CHF' && !dto.iban.startsWith('CH') && !dto.iban.startsWith('LI'))
      throw new BadRequestException(
        'CHF transactions are only permitted to Liechtenstein or Switzerland. Use EUR for other countries.',
      );

    if ('discountCode' in dto) dto.specialCode = dto.discountCode;

    return dto;
  }

  async swapCheck<T extends GetSwapPaymentInfoDto | GetSwapQuoteDto | CreateSwapDto>(
    dto: T,
    jwt?: JwtPayload,
  ): Promise<T> {
    if ('sourceAsset' in dto) {
      dto.sourceAsset = await this.resolveAsset(dto.sourceAsset);
      if (!dto.sourceAsset) throw new NotFoundException('Source asset not found');
      if (!dto.sourceAsset.sellable) throw new BadRequestException('Source asset not sellable');
      if (NoSwapBlockchains.includes(dto.sourceAsset.blockchain))
        throw new BadRequestException('Assets on this blockchain are not swappable');
    }

    if ('blockchain' in dto) {
      if (NoSwapBlockchains.includes(dto.blockchain))
        throw new BadRequestException('Assets on this blockchain are not swappable');
    }

    dto.targetAsset = await this.resolveAsset(dto.targetAsset);
    if (!dto.targetAsset) throw new NotFoundException('Asset not found');
    if (!dto.targetAsset.buyable) throw new BadRequestException('Asset not buyable');
    if (jwt && !dto.targetAsset.isBuyableOn(jwt.blockchains))
      throw new BadRequestException('Asset blockchain mismatch');

    if ('discountCode' in dto) dto.specialCode = dto.discountCode;

    return dto;
  }

  async resolveAsset(asset: Asset): Promise<Asset> {
    return asset.id
      ? this.assetService.getAssetById(asset.id)
      : this.assetService.getAssetByChainId(asset.blockchain, asset.chainId);
  }
}
