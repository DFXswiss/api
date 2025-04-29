import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';

@Injectable()
export class DfxOrderStepAdapter {
  constructor(private readonly blockchainRegistry: BlockchainRegistryService) {}

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
    const route = step.order.sell ?? step.order.swap;

    const targetAddress = route.deposit.address;
    const asset = step.order.outputAsset;
    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
    const custodyWallet = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);

    return asset.type === AssetType.COIN
      ? client.sendNativeCoinFromAccount(custodyWallet, targetAddress, step.order.transactionRequest.amount)
      : client.sendTokenFromAccount(custodyWallet, targetAddress, asset, step.order.transactionRequest.amount);
  }

  private async isSendToComplete(step: CustodyOrderStep): Promise<boolean> {
    const asset = step.order.outputAsset;
    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
    return client.isTxComplete(step.correlationId);
  }
}
