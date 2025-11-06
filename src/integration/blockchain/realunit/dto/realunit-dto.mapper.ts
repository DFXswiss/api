import { AccountHistoryClientResponse, AccountSummaryClientResponse, HoldersClientResponse } from './client.dto';
import { AccountHistoryDto, AccountSummaryDto, HoldersDto } from './realunit.dto';

export class RealunitDtoMapper {
  static toAccountSummaryDto(clientResponse: AccountSummaryClientResponse): AccountSummaryDto {
    const account = clientResponse.account;

    const dto = new AccountSummaryDto();
    dto.address = account.address;
    dto.addressType = account.addressType;
    dto.balance = account.balance;
    dto.lastUpdated = account.lastUpdated;
    dto.historicalBalances = account.historicalBalances.items;

    return dto;
  }

  static toHoldersDto(clientResponse: HoldersClientResponse): HoldersDto {
    const dto = new HoldersDto();

    dto.totalShares = clientResponse.changeTotalShares.items[0];
    dto.totalSupply = clientResponse.totalSupplys.items[0];

    dto.holders = clientResponse.accounts.items.map((holder) => ({
      address: holder.address,
      balance: holder.balance,
      percentage: (100 * Number(holder.balance)) / Number(dto.totalSupply.value),
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
      timestamp: event.timestamp,
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
}
