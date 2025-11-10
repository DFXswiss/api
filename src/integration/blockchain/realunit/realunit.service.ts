import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Contract } from 'ethers';
import { Blockchain } from '../shared/enums/blockchain.enum';
import { EvmClient } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { BlockchainRegistryService } from '../shared/services/blockchain-registry.service';
import { RealUnitDtoMapper } from './dto/realunit-dto.mapper';
import { AccountHistoryDto, AccountSummaryDto, HoldersDto } from './dto/realunit.dto';
import { RealUnitClient } from './realunit-client';

@Injectable()
export class RealUnitService implements OnModuleInit {
  private registryService: BlockchainRegistryService;
  private BROKER_BOT_ADDRESS = '0xCFF32C60B87296B8c0c12980De685bEd6Cb9dD6d';
  private BROKER_BOT_ABI = [
    {
      inputs: [],
      name: 'getPrice',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];

  constructor(private readonly moduleRef: ModuleRef, private readonly realunitClient: RealUnitClient) {}

  getEvmClient(): EvmClient {
    return this.registryService.getClient(Blockchain.ETHEREUM) as EvmClient;
  }

  onModuleInit() {
    this.registryService = this.moduleRef.get(BlockchainRegistryService, { strict: false });
  }

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

  async getRealUnitPrice(): Promise<number> {
    const brokerBotContract = new Contract(this.BROKER_BOT_ADDRESS, this.BROKER_BOT_ABI, this.getEvmClient().wallet);
    const price = await brokerBotContract.getPrice();
    return EvmUtil.fromWeiAmount(price);
  }
}
