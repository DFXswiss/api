import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutInternetComputerService } from '../../../services/payout-icp.service';
import { InternetComputerStrategy } from './base/icp.strategy';

@Injectable()
export class InternetComputerCoinStrategy extends InternetComputerStrategy {
  protected readonly logger = new DfxLogger(InternetComputerCoinStrategy);

  constructor(
    protected readonly internetComputerService: PayoutInternetComputerService,
    private readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(internetComputerService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.INTERNET_COMPUTER;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async getFeeAsset(): Promise<Asset> {
    return this.assetService.getInternetComputerCoin();
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.internetComputerService.sendNativeCoin(order.destinationAddress, order.amount);
  }

  protected async getCurrentGasForTransaction(): Promise<number> {
    return this.internetComputerService.getCurrentGasForCoinTransaction();
  }
}
