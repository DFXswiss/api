import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutSolanaService } from '../../../services/payout-solana.service';
import { SolanaStrategy } from './base/solana.strategy';

@Injectable()
export class SolanaTokenStrategy extends SolanaStrategy {
  protected readonly logger: DfxLogger;

  constructor(
    protected readonly solanaService: PayoutSolanaService,
    readonly loggerFactory: LoggerFactory,
    private readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(solanaService, payoutOrderRepo);

    this.logger = this.loggerFactory.create(SolanaTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.SOLANA;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected async getFeeAsset(): Promise<Asset> {
    return this.assetService.getSolanaCoin();
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.solanaService.sendToken(order.destinationAddress, order.asset, order.amount);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.solanaService.getCurrentGasForTokenTransaction(token);
  }
}
