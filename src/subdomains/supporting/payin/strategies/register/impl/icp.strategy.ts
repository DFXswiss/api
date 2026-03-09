import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { InternetComputerUtil } from 'src/integration/blockchain/icp/icp.util';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { Like, Not } from 'typeorm';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInInternetComputerService } from '../../../services/payin-icp.service';
import { RegisterStrategy } from './base/register.strategy';

const ICRC_BATCH_SIZE = 2000;

@Injectable()
export class InternetComputerStrategy extends RegisterStrategy {
  protected readonly logger = new DfxLogger(InternetComputerStrategy);

  private readonly paymentAddress: string;

  constructor(
    private readonly payInInternetComputerService: PayInInternetComputerService,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly depositService: DepositService,
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
    // Native ICP: per-address Rosetta calls — only active TR addresses + payment address
    const nativeAddresses = await this.transactionRequestService.getActiveDepositAddresses(
      Util.hoursBefore(1),
      this.blockchain,
    );
    if (this.paymentAddress) nativeAddresses.push(this.paymentAddress);

    // ICRC tokens: global ledger scan — all known deposit addresses
    const allDeposits = await this.depositService.getUsedDepositsByBlockchain(this.blockchain);
    const allDepositAddresses = allDeposits.map((d) => d.address);
    if (this.paymentAddress && !allDepositAddresses.includes(this.paymentAddress)) {
      allDepositAddresses.push(this.paymentAddress);
    }

    await this.processNewPayInEntries(
      nativeAddresses.map((a) => BlockchainAddress.create(a, this.blockchain)),
      allDepositAddresses.map((a) => BlockchainAddress.create(a, this.blockchain)),
    );
  }

  async pollAddress(depositAddress: BlockchainAddress, fromBlock?: number, toBlock?: number): Promise<void> {
    if (depositAddress.blockchain !== this.blockchain)
      throw new Error(`Invalid blockchain: ${depositAddress.blockchain}`);

    return this.processNewPayInEntries([depositAddress], [depositAddress], fromBlock, toBlock);
  }

  //*** HELPER METHODS ***//
  private async processNewPayInEntries(
    nativeAddresses: BlockchainAddress[],
    icrcAddresses: BlockchainAddress[],
    fromBlock?: number,
    toBlock?: number,
  ): Promise<void> {
    const log = this.createNewLogObject();

    const nativeEntries = await this.getNativeEntries(nativeAddresses, fromBlock, toBlock);
    const icrcEntries = await this.getIcrcTokenEntries(icrcAddresses, fromBlock, toBlock);

    const newEntries = [...nativeEntries, ...icrcEntries];

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
          if (transfer.to !== accountId) continue;

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

  // --- ICRC token transfers (global ledger, filtered client-side) --- //
  private async getIcrcTokenEntries(
    depositAddresses: BlockchainAddress[],
    fromBlock?: number,
    toBlock?: number,
  ): Promise<PayInEntry[]> {
    const tokenAssets = await this.assetService.getTokens(this.blockchain);
    if (!tokenAssets.length) return [];

    const principalSet = new Set(depositAddresses.map((da) => da.address));
    const entries: PayInEntry[] = [];

    for (const asset of tokenAssets) {
      try {
        const canisterId = asset.chainId;
        if (!canisterId) continue;

        if (!asset.decimals) {
          this.logger.error(`Asset ${asset.name} has no decimals configured, skipping`);
          continue;
        }

        const decimals = asset.decimals;
        const chainLength = await this.payInInternetComputerService.getIcrcBlockHeight(canisterId);
        const lastBlock = fromBlock ?? (await this.getLastCheckedIcrcBlockHeight(canisterId));

        // Cold start: scan last batch to catch recent transfers; afterwards resume from last recorded block
        const startBlock = lastBlock > 0 ? lastBlock + (fromBlock ? 0 : 1) : Math.max(0, chainLength - ICRC_BATCH_SIZE);
        const endBlock = toBlock ?? chainLength;
        if (startBlock >= endBlock) continue;

        const newEntries = await this.fetchIcrcTransfersBatched(
          asset,
          canisterId,
          decimals,
          startBlock,
          endBlock,
          principalSet,
        );

        entries.push(...newEntries);
      } catch (e) {
        this.logger.error(`Failed to fetch ICRC transfers for ${asset.uniqueName ?? asset.name}:`, e);
      }
    }

    return entries;
  }

  private async fetchIcrcTransfersBatched(
    asset: Asset,
    canisterId: string,
    decimals: number,
    startBlock: number,
    chainLength: number,
    principalSet: Set<string>,
  ): Promise<PayInEntry[]> {
    const entries: PayInEntry[] = [];
    let cursor = startBlock;

    while (cursor < chainLength) {
      const count = Math.min(ICRC_BATCH_SIZE, chainLength - cursor);
      const result = await this.payInInternetComputerService.getIcrcTransfers(canisterId, decimals, cursor, count);

      for (const transfer of result.transfers) {
        if (!principalSet.has(transfer.to)) continue;

        entries.push({
          senderAddresses: transfer.from,
          receiverAddress: BlockchainAddress.create(transfer.to, this.blockchain),
          txId: `${canisterId}:${transfer.blockIndex}`,
          txType: this.getTxType(transfer.to),
          blockHeight: transfer.blockIndex,
          amount: transfer.amount,
          asset,
        });
      }

      const nextCursor = result.lastBlockIndex + 1;

      if (nextCursor <= cursor) {
        this.logger.warn(`ICRC ${asset.name}: cursor stuck at ${cursor}, skipping to ${cursor + count}`);
        cursor += count;
      } else {
        cursor = nextCursor;
      }

      if (result.rawTransactionCount === 0) break;
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

  private async getLastCheckedIcrcBlockHeight(canisterId: string): Promise<number> {
    return this.payInRepository
      .findOne({
        select: { id: true, blockHeight: true },
        where: { inTxId: Like(`${canisterId}:%`) },
        order: { blockHeight: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.blockHeight ?? 0);
  }

  private getTxType(resolvedAddress: string): PayInType {
    return resolvedAddress === this.paymentAddress ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
