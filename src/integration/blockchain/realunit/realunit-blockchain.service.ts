import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Contract } from 'ethers';
import { Blockchain } from '../shared/enums/blockchain.enum';
import { EvmClient } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { BlockchainRegistryService } from '../shared/services/blockchain-registry.service';

@Injectable()
export class RealUnitBlockchainService implements OnModuleInit {
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

  constructor(private readonly moduleRef: ModuleRef) {}

  getEvmClient(): EvmClient {
    return this.registryService.getClient(Blockchain.ETHEREUM) as EvmClient;
  }

  onModuleInit() {
    this.registryService = this.moduleRef.get(BlockchainRegistryService, { strict: false });
  }

  async getRealUnitPrice(): Promise<number> {
    const brokerBotContract = new Contract(this.BROKER_BOT_ADDRESS, this.BROKER_BOT_ABI, this.getEvmClient().wallet);
    const price = await brokerBotContract.getPrice();
    return EvmUtil.fromWeiAmount(price);
  }
}
