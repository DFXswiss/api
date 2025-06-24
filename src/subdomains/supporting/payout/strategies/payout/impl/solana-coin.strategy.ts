import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutSolanaService } from '../../../services/payout-solana.service';
import { SolanaStrategy } from './base/solana.strategy';

@Injectable()
export class SolanaCoinStrategy extends SolanaStrategy {
  protected readonly logger: DfxLoggerService;

  constructor(
    protected readonly solanaService: PayoutSolanaService,
    private readonly dfxLogger: DfxLoggerService,
    private readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(solanaService, payoutOrderRepo);

    this.logger = this.dfxLogger.create(SolanaCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.SOLANA;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async getFeeAsset(): Promise<Asset> {
    return this.assetService.getSolanaCoin();
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.solanaService.sendNativeCoin(order.destinationAddress, order.amount);
  }

  protected async getCurrentGasForTransaction(): Promise<number> {
    return this.solanaService.getCurrentGasForCoinTransaction();
  }
}
