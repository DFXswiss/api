import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput, PayInConfirmationType } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { SendStrategy, SendType } from './base/send.strategy';

@Injectable()
export class BinancePayStrategy extends SendStrategy {
  protected readonly logger = new DfxLogger(BinancePayStrategy);

  constructor(private readonly payInRepo: PayInRepository) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.BINANCE_PAY;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get forwardRequired(): boolean {
    return false;
  }

  async doSend(_payIns: CryptoInput[], _type: SendType): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async checkConfirmations(payIns: CryptoInput[], direction: PayInConfirmationType): Promise<void> {
    for (const payIn of payIns) {
      payIn.confirm(direction, this.forwardRequired);

      await this.payInRepo.save(payIn);
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented.');
  }
}
