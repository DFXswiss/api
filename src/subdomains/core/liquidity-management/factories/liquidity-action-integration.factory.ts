import { Injectable } from '@nestjs/common';
import { ArbitrumL2BridgeAdapter } from '../adapters/actions/arbitrum-l2-bridge.adapter';
import { BinanceAdapter } from '../adapters/actions/binance.adapter';
import { DfxDexAdapter } from '../adapters/actions/dfx-dex.adapter';
import { KrakenAdapter } from '../adapters/actions/kraken.adapter';
import { OptimismL2BridgeAdapter } from '../adapters/actions/optimism-l2-bridge.adapter';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityManagementSystem } from '../enums';
import { LiquidityActionIntegration } from '../interfaces';

@Injectable()
export class LiquidityActionIntegrationFactory {
  private readonly adapters = new Map<LiquidityManagementSystem, LiquidityActionIntegration>();

  constructor(
    readonly dfxDexAdapter: DfxDexAdapter,
    readonly arbitrumL2BridgeAdapter: ArbitrumL2BridgeAdapter,
    readonly optimismL2BridgeAdapter: OptimismL2BridgeAdapter,
    readonly krakenAdapter: KrakenAdapter,
    readonly binanceAdapter: BinanceAdapter,
  ) {
    this.adapters.set(LiquidityManagementSystem.DFX_DEX, dfxDexAdapter);
    this.adapters.set(LiquidityManagementSystem.ARBITRUM_L2_BRIDGE, arbitrumL2BridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.OPTIMISM_L2_BRIDGE, optimismL2BridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.KRAKEN, krakenAdapter);
    this.adapters.set(LiquidityManagementSystem.BINANCE, binanceAdapter);
  }

  getIntegration(action: LiquidityManagementAction): LiquidityActionIntegration {
    const { system, command } = action;

    const integration = this.adapters.get(system);

    if (integration && integration.supportedCommands.includes(command)) return integration;

    return null;
  }
}
