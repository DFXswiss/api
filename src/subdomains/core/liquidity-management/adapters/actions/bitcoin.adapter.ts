import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { CorrelationId } from '../../interfaces';
import { LiquidityManagementAdapter } from './base/liquidity-management.adapter';

@Injectable()
export class BitcoinAdapter extends LiquidityManagementAdapter {
  protected commands = new Map<
    string,
    (asset: Asset, amount: number, correlationId: number) => Promise<CorrelationId>
  >();

  constructor() {
    super(LiquidityManagementSystem.BITCOIN);

    this.commands.set('deposit', this.deposit.bind(this));
    this.commands.set('withdraw', this.withdraw.bind(this));
  }

  checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  private async deposit(asset: Asset, amount: number): Promise<CorrelationId> {
    return null;
  }

  private async withdraw(asset: Asset, amount: number): Promise<CorrelationId> {
    return null;
  }
}
