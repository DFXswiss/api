import { Injectable } from '@nestjs/common';
import { DfxDexAdapter } from '../adapters/actions/dfx-dex.adapter';
import { EvmL2BridgeAdapter } from '../adapters/actions/evm-l2-bridge.adapter';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityManagementSystem } from '../enums';
import { LiquidityActionIntegration } from '../interfaces';

@Injectable()
export class LiquidityActionIntegrationFactory {
  protected readonly adapters = new Map<LiquidityManagementSystem, LiquidityActionIntegration>();

  constructor(readonly dfxDexAdapter: DfxDexAdapter, readonly evmL2BridgeAdapter: EvmL2BridgeAdapter) {
    this.adapters.set(LiquidityManagementSystem.DFX_DEX, dfxDexAdapter);
    this.adapters.set(LiquidityManagementSystem.EVM_L2_BRIDGE, evmL2BridgeAdapter);
  }

  getIntegration(action: LiquidityManagementAction): LiquidityActionIntegration {
    const { system, command } = action;

    const integration = this.adapters.get(system);

    if (integration && integration.supportedCommands.includes(command)) return integration;

    return null;
  }
}
