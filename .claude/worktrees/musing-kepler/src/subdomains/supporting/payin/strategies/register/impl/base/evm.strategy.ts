import { Inject, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { RegisterStrategy } from './register.strategy';

export abstract class EvmStrategy extends RegisterStrategy implements OnModuleInit {
  private evmPaymentDepositAddress: string;

  @Inject() private readonly depositService: DepositService;

  onModuleInit() {
    super.onModuleInit();

    this.evmPaymentDepositAddress = EvmUtil.createWallet({ seed: Config.payment.evmSeed, index: 0 }).address;
  }

  // --- HELPER METHODS --- //
  protected async getPayInAddresses(): Promise<string[]> {
    const deposits = await this.depositService.getUsedDepositsByBlockchain(this.blockchain);

    const addresses = deposits.map((dr) => dr.address);
    addresses.push(this.evmPaymentDepositAddress);

    return addresses;
  }

  protected getTxType(address: string): PayInType | undefined {
    return Util.equalsIgnoreCase(this.evmPaymentDepositAddress, address) ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }

  protected getTransactionAsset(supportedAssets: Asset[], chainId?: string): Asset | undefined {
    return chainId
      ? this.assetService.getByChainIdSync(supportedAssets, this.blockchain, chainId)
      : supportedAssets.find((a) => a.type === AssetType.COIN);
  }
}
