import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Contract } from 'ethers';
import { Blockchain } from '../shared/enums/blockchain.enum';
import { EvmClient } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { BlockchainRegistryService } from '../shared/services/blockchain-registry.service';
import {
  BrokerbotBuyPriceDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSharesDto,
} from './dto/realunit-broker.dto';

// Contract addresses
const BROKERBOT_ADDRESS = '0xCFF32C60B87296B8c0c12980De685bEd6Cb9dD6d';
const REALU_TOKEN_ADDRESS = '0x553C7f9C780316FC1D34b8e14ac2465Ab22a090B';
const ZCHF_ADDRESS = '0xb58e61c3098d85632df34eecfb899a1ed80921cb';

// Contract ABIs
const BROKERBOT_ABI = [
  'function getPrice() public view returns (uint256)',
  'function getBuyPrice(uint256 shares) public view returns (uint256)',
  'function getShares(uint256 money) public view returns (uint256)',
  'function settings() public view returns (uint256)',
];

@Injectable()
export class RealUnitBlockchainService implements OnModuleInit {
  private registryService: BlockchainRegistryService;

  constructor(private readonly moduleRef: ModuleRef) {}

  private getEvmClient(): EvmClient {
    return this.registryService.getClient(Blockchain.ETHEREUM) as EvmClient;
  }

  private getBrokerbotContract(): Contract {
    return new Contract(BROKERBOT_ADDRESS, BROKERBOT_ABI, this.getEvmClient().wallet);
  }

  onModuleInit() {
    this.registryService = this.moduleRef.get(BlockchainRegistryService, { strict: false });
  }

  async getRealUnitPrice(): Promise<number> {
    const price = await this.getBrokerbotContract().getPrice();
    return EvmUtil.fromWeiAmount(price);
  }

  // --- Brokerbot Methods ---

  async getBrokerbotPrice(): Promise<BrokerbotPriceDto> {
    const priceRaw = await this.getBrokerbotContract().getPrice();
    return {
      pricePerShare: EvmUtil.fromWeiAmount(priceRaw).toString(),
      pricePerShareRaw: priceRaw.toString(),
    };
  }

  async getBrokerbotBuyPrice(shares: number): Promise<BrokerbotBuyPriceDto> {
    const contract = this.getBrokerbotContract();
    const [totalPriceRaw, pricePerShareRaw] = await Promise.all([contract.getBuyPrice(shares), contract.getPrice()]);

    return {
      shares,
      totalPrice: EvmUtil.fromWeiAmount(totalPriceRaw).toString(),
      totalPriceRaw: totalPriceRaw.toString(),
      pricePerShare: EvmUtil.fromWeiAmount(pricePerShareRaw).toString(),
    };
  }

  async getBrokerbotShares(amountChf: string): Promise<BrokerbotSharesDto> {
    const contract = this.getBrokerbotContract();
    const amountWei = EvmUtil.toWeiAmount(parseFloat(amountChf));
    const [shares, pricePerShareRaw] = await Promise.all([contract.getShares(amountWei), contract.getPrice()]);

    return {
      amount: amountChf,
      shares: shares.toNumber(),
      pricePerShare: EvmUtil.fromWeiAmount(pricePerShareRaw).toString(),
    };
  }

  async getBrokerbotInfo(): Promise<BrokerbotInfoDto> {
    const contract = this.getBrokerbotContract();
    const [priceRaw, settings] = await Promise.all([contract.getPrice(), contract.settings()]);

    // Settings bitmask: bit 0 = buying enabled, bit 1 = selling enabled
    const buyingEnabled = (settings.toNumber() & 1) === 1;
    const sellingEnabled = (settings.toNumber() & 2) === 2;

    return {
      brokerbotAddress: BROKERBOT_ADDRESS,
      tokenAddress: REALU_TOKEN_ADDRESS,
      baseCurrencyAddress: ZCHF_ADDRESS,
      pricePerShare: EvmUtil.fromWeiAmount(priceRaw).toString(),
      buyingEnabled,
      sellingEnabled,
    };
  }
}
