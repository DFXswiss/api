import { BadRequestException, Injectable } from '@nestjs/common';
import { Config, Environment } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { AmlRule } from 'src/subdomains/core/aml/enums/aml-rule.enum';
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
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { QuoteException } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.util';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { Asset } from '../models/asset/asset.entity';
import { AssetService } from '../models/asset/asset.service';
import { Fiat } from '../models/fiat/fiat.entity';
import { FiatService } from '../models/fiat/fiat.service';
import { DisabledProcess, Process } from './process.service';

@Injectable()
export class PaymentInfoService {
  constructor(
    private readonly fiatService: FiatService,
    private readonly assetService: AssetService,
  ) {}

  async buyCheck<T extends GetBuyPaymentInfoDto | GetBuyQuoteDto | CreateBuyDto>(
    dto: T,
    jwt?: JwtPayload,
    user?: User,
    forQuote = false,
  ): Promise<T> {
    if ('currency' in dto) {
      dto.currency = await this.resolveFiat(dto.currency);
      if (!dto.currency) throw this.createError('Currency not found', QuoteError.CURRENCY_UNSUPPORTED, forQuote);
    }

    dto.asset = await this.resolveAsset(dto.asset, forQuote);
    if (!dto.asset) throw this.createError('Asset not found', QuoteError.ASSET_UNSUPPORTED, forQuote);
    if (jwt && !dto.asset.isBuyableOn(jwt.blockchains))
      throw this.createError('Asset blockchain mismatch', QuoteError.ASSET_UNSUPPORTED, forQuote);

    if ('paymentMethod' in dto && dto.paymentMethod === FiatPaymentMethod.CARD) {
      if (!dto.currency.cardSellable)
        throw this.createError('Currency not sellable via Card', QuoteError.CURRENCY_UNSUPPORTED, forQuote);
      if (!dto.asset.cardBuyable)
        throw this.createError('Asset not buyable via Card', QuoteError.ASSET_UNSUPPORTED, forQuote);
    } else if ('paymentMethod' in dto && dto.paymentMethod === FiatPaymentMethod.INSTANT) {
      if (!dto.currency.instantSellable)
        throw this.createError('Currency not sellable via Instant', QuoteError.CURRENCY_UNSUPPORTED, forQuote);
      if (!dto.asset.instantBuyable)
        throw this.createError('Asset not buyable via Instant', QuoteError.ASSET_UNSUPPORTED, forQuote);
    } else {
      if ('currency' in dto && !dto.currency.sellable)
        throw this.createError('Currency not sellable via Bank', QuoteError.CURRENCY_UNSUPPORTED, forQuote);
      if (!dto.asset.buyable)
        throw this.createError(
          `Asset not buyable ${'paymentMethod' in dto ? 'via Bank' : ''}`,
          QuoteError.ASSET_UNSUPPORTED,
          forQuote,
        );
    }

    if ('discountCode' in dto) dto.specialCode = dto.discountCode;

    if (
      user &&
      (!user.wallet?.amlRuleList.includes(AmlRule.SKIP_AML_CHECK) ||
        ![Environment.LOC, Environment.DEV].includes(Config.environment)) &&
      !DisabledProcess(Process.TRADE_APPROVAL_DATE) &&
      !user.userData.tradeApprovalDate &&
      !user.wallet?.autoTradeApproval
    ) {
      throw new BadRequestException(
        user.userData.kycLevel >= KycLevel.LEVEL_10 ? 'RecommendationRequired' : 'EmailRequired',
      );
    }

    return dto;
  }

  async sellCheck<T extends GetSellPaymentInfoDto | GetSellQuoteDto | CreateSellDto>(
    dto: T,
    jwt?: JwtPayload,
    forQuote = false,
  ): Promise<T> {
    if ('asset' in dto) {
      dto.asset = await this.resolveAsset(dto.asset, forQuote);
      if (!dto.asset) throw this.createError('Asset not found', QuoteError.ASSET_UNSUPPORTED, forQuote);
      if (!dto.asset.sellable) throw this.createError('Asset not sellable', QuoteError.ASSET_UNSUPPORTED, forQuote);
      if (jwt && !dto.asset.isBuyableOn(jwt.blockchains))
        throw this.createError('Asset blockchain mismatch', QuoteError.ASSET_UNSUPPORTED, forQuote);
    }

    if ('blockchain' in dto) {
      if (jwt && !jwt.blockchains.includes(dto.blockchain))
        throw this.createError('Asset blockchain mismatch', QuoteError.ASSET_UNSUPPORTED, forQuote);
    }

    dto.currency = await this.resolveFiat(dto.currency);
    if (!dto.currency) throw this.createError('Currency not found', QuoteError.CURRENCY_UNSUPPORTED, forQuote);
    if (!dto.currency.buyable)
      throw this.createError('Currency not buyable', QuoteError.CURRENCY_UNSUPPORTED, forQuote);

    if ('iban' in dto && dto.currency?.name === 'CHF' && !Config.isDomesticIban(dto.iban))
      throw new BadRequestException(
        'CHF transactions are only permitted to Liechtenstein or Switzerland. Use EUR for other countries.',
      );

    if ('discountCode' in dto) dto.specialCode = dto.discountCode;

    return dto;
  }

  async swapCheck<T extends GetSwapPaymentInfoDto | GetSwapQuoteDto | CreateSwapDto>(
    dto: T,
    jwt?: JwtPayload,
    forQuote = false,
  ): Promise<T> {
    if ('sourceAsset' in dto) {
      dto.sourceAsset = await this.resolveAsset(dto.sourceAsset, forQuote);
      if (!dto.sourceAsset) throw this.createError('Source asset not found', QuoteError.ASSET_UNSUPPORTED, forQuote);
      if (!dto.sourceAsset.sellable)
        throw this.createError('Source asset not sellable', QuoteError.ASSET_UNSUPPORTED, forQuote);
      if (NoSwapBlockchains.includes(dto.sourceAsset.blockchain))
        throw this.createError('Assets on this blockchain are not swappable', QuoteError.ASSET_UNSUPPORTED, forQuote);
    }

    if ('blockchain' in dto) {
      if (NoSwapBlockchains.includes(dto.blockchain))
        throw this.createError('Assets on this blockchain are not swappable', QuoteError.ASSET_UNSUPPORTED, forQuote);
    }

    dto.targetAsset = await this.resolveAsset(dto.targetAsset, forQuote);
    if (!dto.targetAsset) throw this.createError('Asset not found', QuoteError.ASSET_UNSUPPORTED, forQuote);
    if (!dto.targetAsset.buyable) throw this.createError('Asset not buyable', QuoteError.ASSET_UNSUPPORTED, forQuote);
    if (jwt && !dto.targetAsset.isBuyableOn(jwt.blockchains))
      throw this.createError('Asset blockchain mismatch', QuoteError.ASSET_UNSUPPORTED, forQuote);

    if ('discountCode' in dto) dto.specialCode = dto.discountCode;

    return dto;
  }

  async resolveAsset(asset: Asset, forQuote = false): Promise<Asset> {
    if (asset.id) return this.assetService.getAssetById(asset.id);

    let blockchain = asset.blockchain;
    if (asset.evmChainId && !blockchain) {
      blockchain = EvmUtil.getBlockchain(asset.evmChainId);
      if (!blockchain) throw this.createError('Unsupported EVM chain ID', QuoteError.ASSET_UNSUPPORTED, forQuote);
    }

    return this.assetService.getAssetByChainId(blockchain, asset.chainId);
  }

  async resolveFiat(fiat: Fiat): Promise<Fiat> {
    if (fiat.id) return this.fiatService.getFiat(fiat.id);
    if (fiat.name) return this.fiatService.getFiatByName(fiat.name);

    return null;
  }

  private createError(message: string, quoteError: QuoteError, forQuote: boolean): Error {
    return forQuote ? new QuoteException(quoteError) : new BadRequestException(message);
  }
}
