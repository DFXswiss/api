import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';
import { CustodyOrderStepCommand } from '../enums/custody';

@Injectable()
export class DfxOrderStepAdapter {
  constructor(
    private readonly blockchainRegistry: BlockchainRegistryService,
    private readonly payoutService: PayoutService,
  ) {}

  async execute(step: CustodyOrderStep): Promise<string> {
    switch (step.command) {
      case CustodyOrderStepCommand.CHARGE_ROUTE: {
        return this.chargeRoute(step);
      }
      case CustodyOrderStepCommand.SEND_TO_ROUTE: {
        return this.sendToRoute(step);
      }
    }
  }

  async isComplete(step: CustodyOrderStep): Promise<boolean> {
    switch (step.command) {
      case CustodyOrderStepCommand.CHARGE_ROUTE:
      case CustodyOrderStepCommand.SEND_TO_ROUTE:
        return this.isTransactionCompleted(step);
    }
  }

  private async sendToRoute(step: CustodyOrderStep): Promise<string> {
    const route = step.order.sell ?? step.order.swap;

    const targetAddress = route.deposit.address;
    const asset = step.order.outputAsset;
    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
    const custodyWallet = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);

    const sendFee = await this.payoutService.estimateBlockchainFee(asset);

    return asset.type === AssetType.COIN
      ? client.sendNativeCoinFromAccount(
          custodyWallet,
          targetAddress,
          step.order.transactionRequest.amount - sendFee.amount,
        )
      : client.sendTokenFromAccount(custodyWallet, targetAddress, asset, step.order.transactionRequest.amount);
  }

  private async chargeRoute(step: CustodyOrderStep): Promise<string> {
    if (step.order.outputAsset.type === AssetType.COIN) {
      return 'NA';
    }
    const asset = step.order.outputAsset;
    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);

    const custodyWallet = EvmUtil.createWallet(
      Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex),
    );

    const sendFee = await this.payoutService.estimateBlockchainFee(asset);

    return client.sendNativeCoinFromDex(custodyWallet.address, sendFee.amount);
  }

  private async isTransactionCompleted(step: CustodyOrderStep): Promise<boolean> {
    const asset = step.order.outputAsset;
    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
    return client.isTxComplete(step.correlationId);
  }
}
