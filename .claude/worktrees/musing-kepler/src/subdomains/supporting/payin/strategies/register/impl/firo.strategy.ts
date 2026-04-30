import { Inject, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { BitcoinUTXO } from 'src/integration/blockchain/bitcoin/node/dto/bitcoin-transaction.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInFiroService } from '../../../services/payin-firo.service';
import { PollingStrategy } from './base/polling.strategy';

@Injectable()
export class FiroStrategy extends PollingStrategy {
  protected readonly logger = new DfxLogger(FiroStrategy);

  @Inject() private readonly depositService: DepositService;

  private unavailableWarningLogged = false;

  constructor(private readonly payInFiroService: PayInFiroService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.FIRO;
  }

  //*** JOBS ***//
  @DfxCron(CronExpression.EVERY_SECOND, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    if (!this.payInFiroService.isAvailable()) {
      if (!this.unavailableWarningLogged) {
        this.logger.warn('Firo node not configured - skipping checkPayInEntries');
        this.unavailableWarningLogged = true;
      }
      return;
    }

    return super.checkPayInEntries();
  }

  //*** HELPER METHODS ***//
  protected async getBlockHeight(): Promise<number> {
    return this.payInFiroService.getBlockHeight();
  }

  protected async getPayInAddresses(): Promise<string[]> {
    const deposits = await this.depositService.getUsedDepositsByBlockchain(this.blockchain);

    const addresses = deposits.map((dr) => dr.address);
    addresses.push(Config.payment.firoAddress);

    return addresses;
  }

  protected async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const newEntries = await this.getNewEntries();

    await this.createPayInsAndSave(newEntries, log);

    this.printInputLog(log, 'omitted', Blockchain.FIRO);
  }

  private async getNewEntries(): Promise<PayInEntry[]> {
    await this.payInFiroService.checkHealthOrThrow();

    const utxos = await this.payInFiroService.getUtxo(Config.blockchain.firo.allowUnconfirmedUtxos);

    return this.mapUtxosToEntries(utxos);
  }

  private async mapUtxosToEntries(utxos: BitcoinUTXO[]): Promise<PayInEntry[]> {
    const asset = await this.assetService.getFiroCoin();
    const toAddresses = await this.getPayInAddresses();

    return utxos
      .filter((u) => toAddresses.includes(u.address))
      .map((u) => ({
        senderAddresses: u.prevoutAddresses.toString(),
        receiverAddress: BlockchainAddress.create(u.address, Blockchain.FIRO),
        txId: u.txid,
        txType: this.getTxType(u.address),
        txSequence: u.vout,
        blockHeight: null,
        amount: u.amount,
        asset,
      }));
  }

  private getTxType(address: string): PayInType | undefined {
    return Util.equalsIgnoreCase(Config.payment.firoAddress, address) ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
