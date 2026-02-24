import { Inject, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { IcpTransfer } from 'src/integration/blockchain/icp/dto/icp.dto';
import { InternetComputerUtil } from 'src/integration/blockchain/icp/icp.util';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { Like } from 'typeorm';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInInternetComputerService } from '../../../services/payin-icp.service';
import { PollingStrategy } from './base/polling.strategy';

const BATCH_SIZE = 1000;

@Injectable()
export class InternetComputerStrategy extends PollingStrategy {
  protected readonly logger = new DfxLogger(InternetComputerStrategy);

  @Inject() private readonly depositService: DepositService;

  private lastProcessedBlock: number | null = null;
  private readonly lastProcessedTokenBlocks: Map<string, number> = new Map();

  private readonly paymentAddress: string;
  private readonly paymentAccountIdentifier: string | undefined;

  constructor(private readonly payInInternetComputerService: PayInInternetComputerService) {
    super();

    const wallet = InternetComputerUtil.createWallet({ seed: Config.payment.internetComputerSeed, index: 0 });
    this.paymentAddress = wallet.address;
    this.paymentAccountIdentifier = InternetComputerUtil.accountIdentifier(wallet.address);
  }

  get blockchain(): Blockchain {
    return Blockchain.INTERNET_COMPUTER;
  }

  //*** JOBS ***//
  @DfxCron(CronExpression.EVERY_SECOND, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    await super.checkPayInEntries();
    await this.processTokenPayInEntries();
  }

  //*** HELPER METHODS ***//
  protected async getBlockHeight(): Promise<number> {
    return this.payInInternetComputerService.getBlockHeight();
  }

  protected async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();

    const lastProcessed = await this.getLastProcessedBlock();
    const start = lastProcessed + 1;

    const result = await this.payInInternetComputerService.getTransfers(start, BATCH_SIZE);

    if (result.lastBlockIndex >= start) {
      this.lastProcessedBlock = result.lastBlockIndex;
    }

    if (result.transfers.length > 0) {
      // query_blocks returns AccountIdentifier hex — match via computed AccountIdentifiers
      const accountIdToDeposit = await this.getDepositAccountIdentifierMap();

      // Add payment address to the map (if configured)
      if (this.paymentAddress && this.paymentAccountIdentifier) {
        accountIdToDeposit.set(this.paymentAccountIdentifier, this.paymentAddress);
      }

      const ownAccountId = this.getOwnWalletAccountIdentifier();
      const relevantTransfers = result.transfers.filter((t) => accountIdToDeposit.has(t.to) && t.from !== ownAccountId);

      if (relevantTransfers.length > 0) {
        const entries = await this.mapToPayInEntries(relevantTransfers, accountIdToDeposit);
        await this.createPayInsAndSave(entries, log);
      }
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  private async processTokenPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const tokenAssets = await this.assetService.getTokens(this.blockchain);
    const depositPrincipals = await this.getDepositPrincipalSet();

    // Add payment address to the set (if configured)
    if (this.paymentAddress) depositPrincipals.add(this.paymentAddress);

    const ownWalletPrincipal = this.payInInternetComputerService.getWalletAddress();

    for (const tokenAsset of tokenAssets) {
      if (!tokenAsset.chainId) continue;

      try {
        const currentHeight = await this.payInInternetComputerService.getIcrcBlockHeight(tokenAsset.chainId);
        const lastIndex = await this.getLastProcessedTokenBlock(tokenAsset.chainId);
        if (lastIndex >= currentHeight) continue;

        const result = await this.payInInternetComputerService.getIcrcTransfers(
          tokenAsset.chainId,
          tokenAsset.decimals,
          lastIndex + 1,
          BATCH_SIZE,
        );

        if (result.lastBlockIndex >= lastIndex + 1) {
          this.lastProcessedTokenBlocks.set(tokenAsset.chainId, result.lastBlockIndex);
        }

        if (result.transfers.length > 0) {
          const relevant = result.transfers.filter((t) => depositPrincipals.has(t.to) && t.from !== ownWalletPrincipal);

          if (relevant.length > 0) {
            const entries = this.mapTokenTransfers(relevant, tokenAsset);
            await this.createPayInsAndSave(entries, log);
          }
        }
      } catch (e) {
        this.logger.error(`Failed to process token ${tokenAsset.uniqueName}:`, e);
      }
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  private async getLastProcessedBlock(): Promise<number> {
    if (this.lastProcessedBlock !== null) return this.lastProcessedBlock;

    const lastPayIn = await this.payInRepository.findOne({
      select: { id: true, blockHeight: true },
      where: { address: { blockchain: this.blockchain } },
      order: { blockHeight: 'DESC' },
      loadEagerRelations: false,
    });

    if (lastPayIn?.blockHeight) {
      this.lastProcessedBlock = lastPayIn.blockHeight;
      return this.lastProcessedBlock;
    }

    this.lastProcessedBlock = await this.payInInternetComputerService.getBlockHeight();
    return this.lastProcessedBlock;
  }

  private async getLastProcessedTokenBlock(canisterId: string): Promise<number> {
    const cached = this.lastProcessedTokenBlocks.get(canisterId);
    if (cached !== undefined) return cached;

    // Check DB for last processed token block (token txIds have format "canisterId:blockIndex")
    const lastPayIn = await this.payInRepository.findOne({
      select: { id: true, blockHeight: true },
      where: { address: { blockchain: this.blockchain }, inTxId: Like(`${canisterId}:%`) },
      order: { blockHeight: 'DESC' },
      loadEagerRelations: false,
    });

    if (lastPayIn?.blockHeight) {
      this.lastProcessedTokenBlocks.set(canisterId, lastPayIn.blockHeight);
      return lastPayIn.blockHeight;
    }

    const blockHeight = await this.payInInternetComputerService.getIcrcBlockHeight(canisterId);
    this.lastProcessedTokenBlocks.set(canisterId, blockHeight);
    return blockHeight;
  }

  private getOwnWalletAccountIdentifier(): string {
    const walletPrincipal = this.payInInternetComputerService.getWalletAddress();
    return InternetComputerUtil.accountIdentifier(walletPrincipal);
  }

  private async getDepositAccountIdentifierMap(): Promise<Map<string, string>> {
    const deposits = await this.depositService.getUsedDepositsByBlockchain(this.blockchain);
    const map = new Map<string, string>();

    for (const deposit of deposits) {
      try {
        const accountId = InternetComputerUtil.accountIdentifier(deposit.address);
        map.set(accountId, deposit.address);
      } catch (e) {
        this.logger.error(`Invalid Principal in deposit ${deposit.id}: ${deposit.address}`, e);
      }
    }

    return map;
  }

  private async getDepositPrincipalSet(): Promise<Set<string>> {
    const deposits = await this.depositService.getUsedDepositsByBlockchain(this.blockchain);
    return new Set(deposits.map((d) => d.address));
  }

  private async mapToPayInEntries(
    transfers: IcpTransfer[],
    accountIdToDeposit: Map<string, string>,
  ): Promise<PayInEntry[]> {
    const asset = await this.assetService.getNativeAsset(this.blockchain);

    return transfers.map((t) => {
      const resolvedAddress = accountIdToDeposit.get(t.to) ?? t.to;
      return {
        senderAddresses: t.from,
        receiverAddress: BlockchainAddress.create(resolvedAddress, this.blockchain),
        txId: t.blockIndex.toString(),
        txType: this.getTxType(resolvedAddress),
        blockHeight: t.blockIndex,
        amount: t.amount,
        asset,
      };
    });
  }

  private mapTokenTransfers(transfers: IcpTransfer[], asset: Asset): PayInEntry[] {
    return transfers.map((t) => ({
      senderAddresses: t.from,
      receiverAddress: BlockchainAddress.create(t.to, this.blockchain),
      txId: `${asset.chainId}:${t.blockIndex}`,
      txType: this.getTxType(t.to),
      blockHeight: t.blockIndex,
      amount: t.amount,
      asset,
    }));
  }

  private getTxType(resolvedAddress: string): PayInType {
    return resolvedAddress === this.paymentAddress ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
