import { Injectable } from '@nestjs/common';
import { ArbitrumL2BridgeAdapter } from '../adapters/actions/arbitrum-l2-bridge.adapter';
import { BaseL2BridgeAdapter } from '../adapters/actions/base-l2-bridge.adapter';
import { BinanceAdapter } from '../adapters/actions/binance.adapter';
import { ClementineBridgeAdapter } from '../adapters/actions/clementine-bridge.adapter';
import { DEuroAdapter } from '../adapters/actions/deuro.adapter';
import { DfxDexAdapter } from '../adapters/actions/dfx-dex.adapter';
import { FrankencoinAdapter } from '../adapters/actions/frankencoin.adapter';
import { JuiceAdapter } from '../adapters/actions/juice.adapter';
import { KrakenAdapter } from '../adapters/actions/kraken.adapter';
import { LayerZeroBridgeAdapter } from '../adapters/actions/layerzero-bridge.adapter';
import { LiquidityPipelineAdapter } from '../adapters/actions/liquidity-pipeline.adapter';
import { MexcAdapter } from '../adapters/actions/mexc.adapter';
import { OptimismL2BridgeAdapter } from '../adapters/actions/optimism-l2-bridge.adapter';
import { PolygonL2BridgeAdapter } from '../adapters/actions/polygon-l2-bridge.adapter';
import { ScryptAdapter } from '../adapters/actions/scrypt.adapter';
import { XtAdapter } from '../adapters/actions/xt.adapter';
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
    readonly polygonL2BridgeAdapter: PolygonL2BridgeAdapter,
    readonly baseL2BridgeAdapter: BaseL2BridgeAdapter,
    readonly layerZeroBridgeAdapter: LayerZeroBridgeAdapter,
    readonly clementineBridgeAdapter: ClementineBridgeAdapter,
    readonly krakenAdapter: KrakenAdapter,
    readonly binanceAdapter: BinanceAdapter,
    readonly mexcAdapter: MexcAdapter,
    readonly scryptAdapter: ScryptAdapter,
    readonly liquidityPipelineAdapter: LiquidityPipelineAdapter,
    readonly frankencoinAdapter: FrankencoinAdapter,
    readonly deuroAdapter: DEuroAdapter,
    readonly juiceAdapter: JuiceAdapter,
    readonly xtAdapter: XtAdapter,
  ) {
    this.adapters.set(LiquidityManagementSystem.DFX_DEX, dfxDexAdapter);
    this.adapters.set(LiquidityManagementSystem.ARBITRUM_L2_BRIDGE, arbitrumL2BridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.OPTIMISM_L2_BRIDGE, optimismL2BridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.POLYGON_L2_BRIDGE, polygonL2BridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.BASE_L2_BRIDGE, baseL2BridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.LAYERZERO_BRIDGE, layerZeroBridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.CLEMENTINE_BRIDGE, clementineBridgeAdapter);
    this.adapters.set(LiquidityManagementSystem.KRAKEN, krakenAdapter);
    this.adapters.set(LiquidityManagementSystem.BINANCE, binanceAdapter);
    this.adapters.set(LiquidityManagementSystem.MEXC, mexcAdapter);
    this.adapters.set(LiquidityManagementSystem.SCRYPT, scryptAdapter);
    this.adapters.set(LiquidityManagementSystem.LIQUIDITY_PIPELINE, liquidityPipelineAdapter);
    this.adapters.set(LiquidityManagementSystem.FRANKENCOIN, frankencoinAdapter);
    this.adapters.set(LiquidityManagementSystem.DEURO, deuroAdapter);
    this.adapters.set(LiquidityManagementSystem.JUICE, juiceAdapter);
    this.adapters.set(LiquidityManagementSystem.XT, xtAdapter);
  }

  getIntegration(action: LiquidityManagementAction): LiquidityActionIntegration {
    const { system, command } = action;

    const integration = this.adapters.get(system);

    if (integration && integration.supportedCommands.includes(command)) return integration;

    return null;
  }
}
