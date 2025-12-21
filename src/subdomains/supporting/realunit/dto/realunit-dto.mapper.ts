import { Util } from 'src/shared/utils/util';
import { AssetPrice } from 'src/subdomains/supporting/pricing/domain/entities/asset-price.entity';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { TimeseriesUtils } from '../utils/timeseries-utils';
import {
  AccountHistoryClientResponse,
  AccountSummaryClientResponse,
  HoldersClientResponse,
  TokenInfoClientResponse,
} from './client.dto';
import { AccountHistoryDto, AccountSummaryDto, HistoricalPriceDto, HoldersDto, TokenInfoDto } from './realunit.dto';

export class RealUnitDtoMapper {
  static toAccountSummaryDto(
    clientResponse: AccountSummaryClientResponse,
    historicalPrices: HistoricalPriceDto[],
  ): AccountSummaryDto {
    const account = clientResponse.account;

    const dto = new AccountSummaryDto();
    dto.address = account.address;
    dto.addressType = account.addressType;
    dto.balance = account.balance;
    dto.lastUpdated = new Date(Number(account.lastUpdated) * 1000);

    const historicalPricesMap = new Map(historicalPrices.map((price) => [Util.isoDate(price.timestamp), price]));

    const historicalBalances = account.historicalBalances.items.map((hb) => ({
      balance: hb.balance,
      created: TimeseriesUtils.stripTime(new Date(Number(hb.timestamp) * 1000)),
    }));

    const historicalBalancesFilled = TimeseriesUtils.fillMissingDates(historicalBalances);

    dto.historicalBalances = historicalBalancesFilled.map((hb) => ({
      balance: hb.balance,
      timestamp: hb.created,
      valueChf: Util.round(historicalPricesMap.get(Util.isoDate(hb.created))?.chf * Number(hb.balance), 4),
    }));

    return dto;
  }

  static toTokenInfoDto(clientResponse: TokenInfoClientResponse): TokenInfoDto {
    const dto = new TokenInfoDto();
    const changeTotalShares = clientResponse.changeTotalShares.items[0];
    dto.totalShares = {
      total: changeTotalShares.total,
      timestamp: new Date(Number(changeTotalShares.timestamp) * 1000),
      txHash: changeTotalShares.txHash,
    };

    const totalSupply = clientResponse.totalSupplys.items[0];
    dto.totalSupply = {
      value: totalSupply.value,
      timestamp: new Date(Number(totalSupply.timestamp) * 1000),
    };

    return dto;
  }

  static toHoldersDto(clientResponse: HoldersClientResponse): HoldersDto {
    const dto = new HoldersDto();

    const totalSupply = clientResponse.totalSupplys.items[0];

    dto.holders = clientResponse.accounts.items.map((holder) => ({
      address: holder.address,
      balance: holder.balance,
      percentage: Util.round((100 * Number(holder.balance)) / Number(totalSupply?.value ?? 1), 3),
    }));

    dto.pageInfo = clientResponse.accounts.pageInfo;
    dto.totalCount = clientResponse.accounts.totalCount;

    return dto;
  }

  static toAccountHistoryDto(clientResponse: AccountHistoryClientResponse): AccountHistoryDto {
    const account = clientResponse.account;
    const history = account.history;

    const dto = new AccountHistoryDto();
    dto.address = account.address;
    dto.addressType = account.addressType;
    dto.history = history.items.map((event) => ({
      timestamp: new Date(Number(event.timestamp) * 1000),
      eventType: event.eventType,
      txHash: event.txHash,
      ...(event.addressTypeUpdate && { addressTypeUpdate: event.addressTypeUpdate }),
      ...(event.approval && { approval: event.approval }),
      ...(event.tokensDeclaredInvalid && { tokensDeclaredInvalid: event.tokensDeclaredInvalid }),
      ...(event.transfer && { transfer: event.transfer }),
    }));
    dto.totalCount = history.totalCount;
    dto.pageInfo = history.pageInfo;

    return dto;
  }

  static priceToHistoricalPriceDto(chfPrice?: Price, eurPrice?: Price, usdPrice?: Price): HistoricalPriceDto {
    return {
      timestamp: chfPrice?.timestamp ?? eurPrice?.timestamp ?? usdPrice?.timestamp ?? new Date(),
      chf: chfPrice ? Util.round(chfPrice.convert(1), 8) : undefined,
      eur: eurPrice ? Util.round(eurPrice.convert(1), 8) : undefined,
      usd: usdPrice ? Util.round(usdPrice.convert(1), 8) : undefined,
    };
  }

  static assetPricesToHistoricalPricesDto(prices: AssetPrice[]): HistoricalPriceDto[] {
    return prices.map((price) => ({
      timestamp: price.created,
      chf: price.priceChf,
      eur: price.priceEur,
      usd: price.priceUsd,
    }));
  }
}
