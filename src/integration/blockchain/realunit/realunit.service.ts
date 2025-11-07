import { Injectable } from '@nestjs/common';
import { RealUnitDtoMapper } from './dto/realunit-dto.mapper';
import { AccountHistoryDto, AccountSummaryDto, HoldersDto } from './dto/realunit.dto';
import { RealUnitClient } from './realunit-client';

@Injectable()
export class RealUnitService {
  constructor(private readonly realunitClient: RealUnitClient) {}

  async getAccount(address: string): Promise<AccountSummaryDto> {
    const clientResponse = await this.realunitClient.getAccountSummary(address);
    return RealUnitDtoMapper.toAccountSummaryDto(clientResponse);
  }

  async getHolders(first?: number, after?: string): Promise<HoldersDto> {
    const clientResponse = await this.realunitClient.getHolders(first, after);
    return RealUnitDtoMapper.toHoldersDto(clientResponse);
  }

  async getAccountHistory(address: string, first?: number, after?: string): Promise<AccountHistoryDto> {
    const clientResponse = await this.realunitClient.getAccountHistory(address, first, after);
    return RealUnitDtoMapper.toAccountHistoryDto(clientResponse);
  }
}
