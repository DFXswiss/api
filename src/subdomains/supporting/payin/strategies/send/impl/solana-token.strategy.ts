import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInSolanaService } from '../../../services/payin-solana.service';
import { SolanaStrategy } from './base/solana.strategy';

@Injectable()
export class SolanaTokenStrategy extends SolanaStrategy {
  protected readonly logger = new DfxLogger(SolanaTokenStrategy);

  constructor(payInSolanaService: PayInSolanaService, payInRepo: PayInRepository) {
    super(payInSolanaService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.SOLANA;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(this.payInSolanaService.getWalletAddress(), this.blockchain);
  }

  protected async sendTransfer(payIn: CryptoInput): Promise<string> {
    const account = Config.blockchain.solana.walletAccount(payIn.route.deposit.accountIndex);

    return this.payInSolanaService.sendToken(account, payIn.destinationAddress.address, payIn.asset, payIn.amount);
  }
}
