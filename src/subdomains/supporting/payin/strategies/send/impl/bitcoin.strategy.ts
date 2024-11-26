import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class BitcoinStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(BitcoinStrategy);

  constructor(
    protected readonly bitcoinService: PayInBitcoinService,
    protected payInRepo: PayInRepository,
    private readonly repoFactory: RepositoryFactory,
  ) {
    super(bitcoinService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.default.btcOutput.address, Blockchain.BITCOIN);
  }

  protected async isConfirmed(txId: string, minConfirmations: number): Promise<boolean> {
    const { confirmations } = await this.bitcoinService.getTx(txId);
    return confirmations >= minConfirmations;
  }
}
