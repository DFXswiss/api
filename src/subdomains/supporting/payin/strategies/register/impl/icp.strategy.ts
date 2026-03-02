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
import { Like, Not } from 'typeorm';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInInternetComputerService } from '../../../services/payin-icp.service';
import { RegisterStrategy } from './base/register.strategy';

const BATCH_SIZE = 1000;

@Injectable()
export class InternetComputerStrategy extends RegisterStrategy {
  protected readonly logger = new DfxLogger(InternetComputerStrategy);

  private readonly paymentAddress: string;
  private readonly paymentAccountIdentifier: string | undefined;

  constructor(
    private readonly payInInternetComputerService: PayInInternetComputerService,
    private readonly transactionRequestService: TransactionRequestService,
  ) {
    super();

    const wallet = InternetComputerUtil.createWallet({ seed: Config.payment.internetComputerSeed, index: 0 });
    this.paymentAddress = wallet.address;
    this.paymentAccountIdentifier = InternetComputerUtil.accountIdentifier(wallet.address);
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

    const newEntries: PayInEntry[] = [];

    // native ICP
    newEntries.push(...(await this.getNativeEntries(depositAddresses, fromBlock, toBlock)));

    // ICRC-1 tokens
    newEntries.push(...(await this.getTokenEntries(depositAddresses, fromBlock, toBlock)));

    if (newEntries.length) {
      await this.createPayInsAndSave(newEntries, log);
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  // --- Native ICP (query_blocks → AccountIdentifier matching) --- //
  private async getNativeEntries(
    depositAddresses: BlockchainAddress[],
    fromBlock?: number,
    toBlock?: number,
  ): Promise<PayInEntry[]> {
    // build AccountIdentifier → Principal map for all deposit addresses
    const accountIdToAddress = new Map<string, string>();
    for (const da of depositAddresses) {
      try {
        const accountId = InternetComputerUtil.accountIdentifier(da.address);
        accountIdToAddress.set(accountId, da.address);
      } catch (e) {
        this.logger.error(`Invalid Principal in deposit address ${da.address}`, e);
      }
    }

    if (this.paymentAddress && this.paymentAccountIdentifier) {
      accountIdToAddress.set(this.paymentAccountIdentifier, this.paymentAddress);
    }

    // determine start block: global minimum across all addresses
    const perAddressFromBlock = new Map<string, number>();

    if (fromBlock === undefined) {
      for (const da of depositAddresses) {
        const lastBlock = await this.getLastCheckedNativeBlockHeight(da);
        perAddressFromBlock.set(da.address, lastBlock + 1);
      }
    } else {
      for (const da of depositAddresses) perAddressFromBlock.set(da.address, fromBlock);
    }

    const globalFrom = Math.min(...perAddressFromBlock.values());

    // new addresses without any records would return 0+1=1 → fetch from block 1 = full history
    // fallback: use current block height for those
    const currentHeight = await this.payInInternetComputerService.getBlockHeight();
    if (globalFrom > currentHeight) return [];

    const effectiveFrom = globalFrom <= 0 ? currentHeight : globalFrom;

    const result = await this.payInInternetComputerService.getTransfers(effectiveFrom, BATCH_SIZE);
    if (result.transfers.length === 0) return [];

    const ownAccountId = InternetComputerUtil.accountIdentifier(this.payInInternetComputerService.getWalletAddress());

    const asset = await this.assetService.getNativeAsset(this.blockchain);

    const entries: PayInEntry[] = [];
    for (const transfer of result.transfers) {
      const resolvedAddress = accountIdToAddress.get(transfer.to);
      if (!resolvedAddress) continue;
      if (transfer.from === ownAccountId) continue;

      // per-address block filter
      const addressFrom = perAddressFromBlock.get(resolvedAddress) ?? effectiveFrom;
      if (transfer.blockIndex < addressFrom) continue;
      if (toBlock !== undefined && transfer.blockIndex > toBlock) continue;

      entries.push({
        senderAddresses: transfer.from,
        receiverAddress: BlockchainAddress.create(resolvedAddress, this.blockchain),
        txId: transfer.blockIndex.toString(),
        txType: this.getTxType(resolvedAddress),
        blockHeight: transfer.blockIndex,
        amount: transfer.amount,
        asset,
      });
    }

    return entries;
  }

  // --- ICRC-1 Tokens (get_transactions → Principal matching) --- //
  private async getTokenEntries(
    depositAddresses: BlockchainAddress[],
    fromBlock?: number,
    toBlock?: number,
  ): Promise<PayInEntry[]> {
    const tokenAssets = await this.assetService.getTokens(this.blockchain);
    const depositPrincipals = new Set(depositAddresses.map((da) => da.address));
    if (this.paymentAddress) depositPrincipals.add(this.paymentAddress);

    const ownWalletPrincipal = this.payInInternetComputerService.getWalletAddress();

    const entries: PayInEntry[] = [];

    for (const tokenAsset of tokenAssets) {
      if (!tokenAsset.chainId) continue;

      try {
        // determine per-address start blocks for this token
        const perAddressFromBlock = new Map<string, number>();

        if (fromBlock === undefined) {
          for (const da of depositAddresses) {
            const lastBlock = await this.getLastCheckedTokenBlockHeight(da, tokenAsset.chainId);
            perAddressFromBlock.set(da.address, lastBlock + 1);
          }
        } else {
          for (const da of depositAddresses) perAddressFromBlock.set(da.address, fromBlock);
        }

        const globalFrom = Math.min(...perAddressFromBlock.values());

        const currentHeight = await this.payInInternetComputerService.getIcrcBlockHeight(tokenAsset.chainId);
        if (globalFrom > currentHeight) continue;

        const effectiveFrom = globalFrom <= 0 ? currentHeight : globalFrom;

        const result = await this.payInInternetComputerService.getIcrcTransfers(
          tokenAsset.chainId,
          tokenAsset.decimals,
          effectiveFrom,
          BATCH_SIZE,
        );

        if (result.transfers.length === 0) continue;

        for (const transfer of result.transfers) {
          if (!depositPrincipals.has(transfer.to)) continue;
          if (transfer.from === ownWalletPrincipal) continue;

          const addressFrom = perAddressFromBlock.get(transfer.to) ?? effectiveFrom;
          if (transfer.blockIndex < addressFrom) continue;
          if (toBlock !== undefined && transfer.blockIndex > toBlock) continue;

          entries.push({
            senderAddresses: transfer.from,
            receiverAddress: BlockchainAddress.create(transfer.to, this.blockchain),
            txId: `${tokenAsset.chainId}:${transfer.blockIndex}`,
            txType: this.getTxType(transfer.to),
            blockHeight: transfer.blockIndex,
            amount: transfer.amount,
            asset: tokenAsset,
          });
        }
      } catch (e) {
        this.logger.error(`Failed to process token ${tokenAsset.uniqueName}:`, e);
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

  private async getLastCheckedTokenBlockHeight(depositAddress: BlockchainAddress, canisterId: string): Promise<number> {
    return this.payInRepository
      .findOne({
        select: { id: true, blockHeight: true },
        where: { address: depositAddress, inTxId: Like(`${canisterId}:%`) },
        order: { blockHeight: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.blockHeight ?? 0);
  }

  private getTxType(resolvedAddress: string): PayInType {
    return resolvedAddress === this.paymentAddress ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
