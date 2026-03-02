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
export class InternetComputerTokenStrategy extends InternetComputerStrategy {
  protected readonly logger = new DfxLogger(InternetComputerTokenStrategy);

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
    return AssetType.TOKEN;
  }

  protected async getFeeAsset(): Promise<Asset> {
    return this.assetService.getInternetComputerCoin();
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.internetComputerService.sendToken(order.destinationAddress, order.asset, order.amount);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.internetComputerService.getCurrentGasForTokenTransaction(token);
  }
}
