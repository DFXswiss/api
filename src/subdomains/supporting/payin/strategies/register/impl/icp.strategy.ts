import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { InternetComputerUtil } from 'src/integration/blockchain/icp/icp.util';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { Not, Like } from 'typeorm';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInInternetComputerService } from '../../../services/payin-icp.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class InternetComputerStrategy extends RegisterStrategy {
  protected readonly logger = new DfxLogger(InternetComputerStrategy);

  private readonly paymentAddress: string;

  constructor(
    private readonly payInInternetComputerService: PayInInternetComputerService,
    private readonly transactionRequestService: TransactionRequestService,
  ) {
    super();

    const wallet = InternetComputerUtil.createWallet({ seed: Config.payment.internetComputerSeed, index: 0 });
    this.paymentAddress = wallet.address;
  }

  get blockchain(): Blockchain {
    return Blockchain.INTERNET_COMPUTER;
  }

  //*** JOBS ***//
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    const activeDepositAddresses = await this.transactionRequestService.getActiveDepositAddresses(
      Util.hoursBefore(1),
      this.blockchain,
    );

    if (this.paymentAddress) activeDepositAddresses.push(this.paymentAddress);

    await this.processNewPayInEntries(activeDepositAddresses.map((a) => BlockchainAddress.create(a, this.blockchain)));
  }

  async pollAddress(depositAddress: BlockchainAddress, fromBlock?: number, toBlock?: number): Promise<void> {
    if (depositAddress.blockchain !== this.blockchain)
      throw new Error(`Invalid blockchain: ${depositAddress.blockchain}`);

    return this.processNewPayInEntries([depositAddress], fromBlock, toBlock);
  }

  //*** HELPER METHODS ***//
  private async processNewPayInEntries(
    depositAddresses: BlockchainAddress[],
    fromBlock?: number,
    toBlock?: number,
  ): Promise<void> {
    const log = this.createNewLogObject();

    const newEntries = await this.getNativeEntries(depositAddresses, fromBlock, toBlock);

    if (newEntries.length) {
      await this.createPayInsAndSave(newEntries, log);
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  // --- Native ICP (Rosetta per-address history) --- //
  private async getNativeEntries(
    depositAddresses: BlockchainAddress[],
    fromBlock?: number,
    toBlock?: number,
  ): Promise<PayInEntry[]> {
    const ownAccountId = InternetComputerUtil.accountIdentifier(this.payInInternetComputerService.getWalletAddress());
    const asset = await this.assetService.getNativeAsset(this.blockchain);

    const entries: PayInEntry[] = [];

    for (const da of depositAddresses) {
      try {
        const accountId = InternetComputerUtil.accountIdentifier(da.address);
        const lastBlock = fromBlock ?? (await this.getLastCheckedNativeBlockHeight(da)) + 1;

        const transfers = await this.payInInternetComputerService.getNativeTransfersForAddress(accountId);

        for (const transfer of transfers) {
          if (transfer.blockIndex < lastBlock) continue;
          if (toBlock !== undefined && transfer.blockIndex > toBlock) continue;
          if (transfer.from === ownAccountId) continue;

          entries.push({
            senderAddresses: transfer.from,
            receiverAddress: BlockchainAddress.create(da.address, this.blockchain),
            txId: transfer.blockIndex.toString(),
            txType: this.getTxType(da.address),
            blockHeight: transfer.blockIndex,
            amount: transfer.amount,
            asset,
          });
        }
      } catch (e) {
        this.logger.error(`Failed to fetch native transfers for ${da.address}:`, e);
      }
    }

    return entries;
  }

  // --- DB-based block height lookups --- //
  private async getLastCheckedNativeBlockHeight(depositAddress: BlockchainAddress): Promise<number> {
    return this.payInRepository
      .findOne({
        select: { id: true, blockHeight: true },
        where: { address: depositAddress, inTxId: Not(Like('%:%')) },
        order: { blockHeight: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.blockHeight ?? 0);
  }

  private getTxType(resolvedAddress: string): PayInType {
    return resolvedAddress === this.paymentAddress ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
