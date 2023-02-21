import { Injectable } from '@nestjs/common';
import { DfxDexAdapter } from '../adapters/actions/dfx-dex.adapter';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityManagementSystem } from '../enums';
import { LiquidityActionIntegration } from '../interfaces';
import { ArbitrumL2BridgeAdapter } from '../adapters/actions/arbitrum-l2-bridge.adapter';
import { OptimismL2BridgeAdapter } from '../adapters/actions/optimism-l2-bridge.adapter';
import { BitcoinAdapter } from '../adapters/actions/bitcoin.adapter';
import { CakeAdapter } from '../adapters/actions/cake.adapter';
import { KrakenAdapter } from '../adapters/actions/kraken.adapter';
import { BinanceAdapter } from '../adapters/actions/binance.adapter';

@Injectable()
export class LiquidityActionIntegrationFactory {
  protected readonly adapters = new Map<LiquidityManagementSystem, LiquidityActionIntegration>();

  constructor(
    readonly dfxDexAdapter: DfxDexAdapter,
    readonly arbitrumL2BridgeAdapter: ArbitrumL2BridgeAdapter,
    readonly optimismL2BridgeAdapter: OptimismL2BridgeAdapter,
    readonly cakeAdapter: CakeAdapter,
    readonly krakenAdapter: KrakenAdapter,
    readonly binanceAdapter: BinanceAdapter,
    readonly bitcoinAdapter: BitcoinAdapter,
  ) {
    this.adapters.set(LiquidityManagementSystem.DFX_DEX, dfxDexAdapter);
    this.adapters.set(LiquidityManagementSystem.ARBITRUM_L2_BRIDGE, arbitrumL2BridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.OPTIMISM_L2_BRIDGE, optimismL2BridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.CAKE, cakeAdapter);
    this.adapters.set(LiquidityManagementSystem.KRAKEN, krakenAdapter);
    this.adapters.set(LiquidityManagementSystem.BINANCE, binanceAdapter);
    this.adapters.set(LiquidityManagementSystem.BITCOIN, bitcoinAdapter);
  }

  getIntegration(action: LiquidityManagementAction): LiquidityActionIntegration {
    const { system, command } = action;

    const integration = this.adapters.get(system);

    if (integration && integration.supportedCommands.includes(command)) return integration;

    return null;
  }
}
