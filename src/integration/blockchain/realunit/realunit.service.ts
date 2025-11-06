import { Injectable } from '@nestjs/common';
import { RealunitDtoMapper } from './dto/realunit-dto.mapper';
import { AccountHistoryDto, AccountSummaryDto, HoldersDto } from './dto/realunit.dto';
import { RealunitClient } from './realunit-client';

@Injectable()
export class RealunitService {
  constructor(private readonly realunitClient: RealunitClient) {}

  async getAccount(address: string): Promise<AccountSummaryDto> {
    const clientResponse = await this.realunitClient.getAccountSummary(address);
    return RealunitDtoMapper.toAccountSummaryDto(clientResponse);
  }

  async getHolders(first?: number, after?: string): Promise<HoldersDto> {
    const clientResponse = await this.realunitClient.getHolders(first, after);
    return RealunitDtoMapper.toHoldersDto(clientResponse);
  }

  async getAccountHistory(address: string, first?: number, after?: string): Promise<AccountHistoryDto> {
    const clientResponse = await this.realunitClient.getAccountHistory(address, first, after);
    return RealunitDtoMapper.toAccountHistoryDto(clientResponse);
  }
}
