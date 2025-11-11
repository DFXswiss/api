import { Util } from 'src/shared/utils/util';
import { AssetPrice } from 'src/subdomains/supporting/pricing/domain/entities/asset-price.entity';
import { PriceUtils } from '../utils/price-utils';
import { AccountHistoryClientResponse, AccountSummaryClientResponse, HoldersClientResponse } from './client.dto';
import { AccountHistoryDto, AccountSummaryDto, HistoricalPriceDto, HoldersDto } from './realunit.dto';

export class RealUnitDtoMapper {
  static toAccountSummaryDto(
    clientResponse: AccountSummaryClientResponse,
    historicalPrices?: AssetPrice[],
  ): AccountSummaryDto {
    const account = clientResponse.account;

    const dto = new AccountSummaryDto();
    dto.address = account.address;
    dto.addressType = account.addressType;
    dto.balance = account.balance;
    dto.lastUpdated = new Date(Number(account.lastUpdated) * 1000);

    const historicalPricesMap = PriceUtils.toTimestampMap(historicalPrices);

    const historicalBalances = account.historicalBalances.items.map((hb) => ({
      balance: hb.balance,
      created: PriceUtils.stripTime(new Date(Number(hb.timestamp) * 1000)),
    }));

    const historicalBalancesFilled = PriceUtils.fillMissingDates(historicalBalances);

    dto.historicalBalances = historicalBalancesFilled.map((hb) => ({
      balance: hb.balance,
      timestamp: hb.created,
      valueChf: Util.round(historicalPricesMap.get(hb.created.getTime())?.priceChf * Number(hb.balance), 4),
    }));

    return dto;
  }

  static toHoldersDto(clientResponse: HoldersClientResponse): HoldersDto {
    const dto = new HoldersDto();

    const totalShares = clientResponse.changeTotalShares.items[0];
    const totalSupply = clientResponse.totalSupplys.items[0];

    dto.totalShares = totalShares
      ? {
          total: totalShares.total,
          timestamp: new Date(Number(totalShares.timestamp) * 1000),
          txHash: totalShares.txHash,
        }
      : null;

    dto.totalSupply = totalSupply
      ? {
          value: totalSupply.value,
          timestamp: new Date(Number(totalSupply.timestamp) * 1000),
        }
      : null;

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

  static toHistoricalPrices(prices: AssetPrice[]): HistoricalPriceDto[] {
    return prices.map((price) => ({
      timestamp: price.created,
      chf: price.priceChf,
      eur: price.priceEur,
      usd: price.priceUsd,
    }));
  }
}
