import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput, PayInConfirmationType } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInMoneroService } from '../../../services/payin-monero.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class MoneroStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(MoneroStrategy);

  constructor(private readonly moneroService: PayInMoneroService, readonly payInRepo: PayInRepository) {
    super(moneroService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.MONERO;
  }

  get assetType(): AssetType {
    return undefined;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.monero.walletAddress, Blockchain.MONERO);
  }

  protected async isConfirmed(payIn: CryptoInput, direction: PayInConfirmationType): Promise<boolean> {
    const transaction = await this.moneroService.getTransaction(payIn.confirmationTxId(direction));
    return MoneroHelper.isTransactionComplete(transaction);
  }
}
