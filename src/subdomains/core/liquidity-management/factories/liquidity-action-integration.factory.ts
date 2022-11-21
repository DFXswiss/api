import { Injectable } from '@nestjs/common';
import { DfxDexAdapter } from '../adapters/actions/dfx-dex.adapter';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityManagementSystem } from '../enums';
import { LiquidityActionIntegration } from '../interfaces';

@Injectable()
export class LiquidityActionIntegrationFactory {
  protected readonly adapters = new Map<LiquidityManagementSystem, LiquidityActionIntegration>();

  constructor(readonly dfxDexAdapter: DfxDexAdapter) {
    this.adapters.set(LiquidityManagementSystem.DFX_DEX, dfxDexAdapter);
  }

  getIntegration(action: LiquidityManagementAction): LiquidityActionIntegration {
    const { system, command } = action;

    const integration = this.adapters.get(system);

    if (integration && integration.supportedCommands.includes(command)) return integration;

    return null;
  }
}
