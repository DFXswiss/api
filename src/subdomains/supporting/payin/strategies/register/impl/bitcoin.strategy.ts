import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { BitcoinUTXO } from 'src/integration/blockchain/bitcoin/node/dto/bitcoin-transaction.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class BitcoinStrategy extends RegisterStrategy {
  protected readonly logger = new DfxLogger(BitcoinStrategy);

  constructor(private readonly bitcoinService: PayInBitcoinService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  //*** JOBS ***//

  @DfxCron(CronExpression.EVERY_30_SECONDS, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    await this.processNewPayInEntries();
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const newEntries = await this.getNewEntries();

    await this.createPayInsAndSave(newEntries, log);

    this.printInputLog(log, 'omitted', Blockchain.BITCOIN);
  }

  private async getNewEntries(): Promise<PayInEntry[]> {
    await this.bitcoinService.checkHealthOrThrow();

    const utxos = await this.bitcoinService.getUtxo();

    return this.mapUtxosToEntries(utxos);
  }

  private async mapUtxosToEntries(utxos: BitcoinUTXO[]): Promise<PayInEntry[]> {
    const asset = await this.assetService.getBtcCoin();

    return utxos.map((u) => ({
      senderAddresses: u.prevoutAddresses.toString(),
      receiverAddress: BlockchainAddress.create(u.address, Blockchain.BITCOIN),
      txId: u.txid,
      txType: this.getTxType(u.address),
      txSequence: u.vout,
      blockHeight: null,
      amount: u.amount.toNumber(),
      asset,
    }));
  }

  private getTxType(address: string): PayInType | undefined {
    return Util.equalsIgnoreCase(Config.payment.bitcoinAddress, address) ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
