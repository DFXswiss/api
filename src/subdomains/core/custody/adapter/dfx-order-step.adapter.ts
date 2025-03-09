import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { SwapService } from '../../buy-crypto/routes/swap/swap.service';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';
import { CustodyOrderType } from '../enums/custody';

@Injectable()
export class DfxOrderStepAdapter {
  private readonly logger = new DfxLogger(DfxOrderStepAdapter);

  constructor(
    private readonly sellService: SellService,
    private readonly swapService: SwapService,
    private readonly blockchainRegistry: BlockchainRegistryService,
    private readonly assetService: AssetService,
  ) {}

  async execute(step: CustodyOrderStep): Promise<string> {
    switch (step.command) {
      case 'SendToRoute':
        return this.sendToRoute(step);
    }
  }

  async isComplete(step: CustodyOrderStep): Promise<boolean> {
    switch (step.command) {
      case 'SendToRoute':
        return this.isSendToComplete(step);
    }
  }

  private async sendToRoute(step: CustodyOrderStep): Promise<string> {
    const route =
      step.order.type === CustodyOrderType.WITHDRAWAL
        ? await this.sellService.getById(step.order.transactionRequest.routeId)
        : await this.swapService.getById(step.order.transactionRequest.routeId);

    const targetAddress = route.deposit.address;
    const asset = await this.assetService.getAssetById(step.order.transactionRequest.sourceId);
    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
    const custodyWallet = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);

    return asset.type === AssetType.COIN
      ? client.sendNativeCoinFromAccount(custodyWallet, targetAddress, step.order.transactionRequest.amount)
      : client.sendTokenFromAccount(custodyWallet, targetAddress, asset, step.order.transactionRequest.amount);
  }

  private async isSendToComplete(step: CustodyOrderStep): Promise<boolean> {
    const asset = await this.assetService.getAssetById(step.order.transactionRequest.sourceId);
    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
    return client.isTxComplete(step.correlationId);
  }
}
