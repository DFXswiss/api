import { Injectable, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ArbitrumService } from 'src/integration/blockchain/arbitrum/arbitrum.service';
import { BaseService } from 'src/integration/blockchain/base/base.service';
import { BscService } from 'src/integration/blockchain/bsc/bsc.service';
import { CitreaTestnetService } from 'src/integration/blockchain/citrea-testnet/citrea-testnet.service';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { GnosisService } from 'src/integration/blockchain/gnosis/gnosis.service';
import { OptimismService } from 'src/integration/blockchain/optimism/optimism.service';
import { PolygonService } from 'src/integration/blockchain/polygon/polygon.service';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { PayoutEvmService } from './payout-evm.service';

const EVM_SERVICE_MAP: Partial<Record<Blockchain, Type<EvmService>>> = {
  [Blockchain.ETHEREUM]: EthereumService,
  [Blockchain.SEPOLIA]: SepoliaService,
  [Blockchain.BINANCE_SMART_CHAIN]: BscService,
  [Blockchain.ARBITRUM]: ArbitrumService,
  [Blockchain.OPTIMISM]: OptimismService,
  [Blockchain.POLYGON]: PolygonService,
  [Blockchain.BASE]: BaseService,
  [Blockchain.GNOSIS]: GnosisService,
  [Blockchain.CITREA_TESTNET]: CitreaTestnetService,
};

@Injectable()
export class PayoutEvmFactory {
  private readonly instances = new Map<Blockchain, PayoutEvmService>();

  constructor(private readonly moduleRef: ModuleRef) {}

  getPayoutService(blockchain: Blockchain): PayoutEvmService {
    if (!this.instances.has(blockchain)) {
      const serviceClass = EVM_SERVICE_MAP[blockchain];
      if (!serviceClass) {
        throw new Error(`No Payout service configured for blockchain: ${blockchain}`);
      }

      const blockchainService = this.moduleRef.get(serviceClass, { strict: false });
      const payoutService = new PayoutEvmService(blockchainService);
      this.instances.set(blockchain, payoutService);
    }

    return this.instances.get(blockchain)!;
  }
}
