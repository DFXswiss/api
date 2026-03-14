import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { InternetComputerUtil } from 'src/integration/blockchain/icp/icp.util';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInInternetComputerService } from '../../../services/payin-icp.service';
import { RegisterStrategy } from './base/register.strategy';

const BATCH_SIZE = 2000;
const SETTING_KEY = 'icpLastScannedBlocks';

@Injectable()
export class InternetComputerStrategy extends RegisterStrategy {
  protected readonly logger = new DfxLogger(InternetComputerStrategy);

  private readonly paymentAddress: string;

  constructor(
    private readonly payInInternetComputerService: PayInInternetComputerService,
    private readonly depositService: DepositService,
    private readonly settingService: SettingService,
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
    const allDeposits = await this.depositService.getUsedDepositsByBlockchain(this.blockchain);
    const allDepositAddresses = allDeposits.map((d) => d.address);

    if (this.paymentAddress && !allDepositAddresses.includes(this.paymentAddress)) {
      allDepositAddresses.push(this.paymentAddress);
    }

    await this.processNewPayInEntries(allDepositAddresses, true);
  }

  async pollAddress(depositAddress: BlockchainAddress, fromBlock?: number, toBlock?: number): Promise<void> {
    if (depositAddress.blockchain !== this.blockchain)
      throw new Error(`Invalid blockchain: ${depositAddress.blockchain}`);

    return this.processNewPayInEntries([depositAddress.address], false, fromBlock, toBlock);
  }

  //*** HELPER METHODS ***//
  private async processNewPayInEntries(
    depositAddresses: string[],
    persistProgress: boolean,
    fromBlock?: number,
    toBlock?: number,
  ): Promise<void> {
    const log = this.createNewLogObject();
    const scanState: Record<string, number> = persistProgress ? await this.getScanState() : {};
    const assets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    const newEntries: PayInEntry[] = [];
    for (const asset of assets) {
      try {
        const entries = await this.scanLedger(asset, scanState, depositAddresses, fromBlock, toBlock);
        newEntries.push(...entries);
      } catch (e) {
        this.logger.error(`Failed to scan ${asset.name}:`, e);
      }
    }

    if (newEntries.length) {
      await this.createPayInsAndSave(newEntries, log);
    }

    if (persistProgress && Object.keys(scanState).length) {
      await this.saveScanState(scanState);
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  // --- Generic ledger scanner --- //
  private async scanLedger(
    asset: Asset,
    scanState: Record<string, number>,
    depositAddresses: string[],
    fromBlock?: number,
    toBlock?: number,
  ): Promise<PayInEntry[]> {
    const isNative = asset.type === AssetType.COIN;
    const canisterId = asset.chainId;

    if (!isNative && !asset.decimals) {
      this.logger.error(`Asset ${asset.name} has no decimals configured, skipping`);
      return [];
    }

    // Build address lookup: maps transfer.to → principal address
    const addressLookup = new Map(
      depositAddresses.map((p) => [isNative ? InternetComputerUtil.accountIdentifier(p) : p, p]),
    );

    // Determine block range
    const stateKey = asset.id.toString();
    const lastScanned = scanState[stateKey];

    const chainLength = isNative
      ? await this.payInInternetComputerService.getBlockHeight()
      : await this.payInInternetComputerService.getIcrcBlockHeight(canisterId);

    const endBlock = toBlock ?? chainLength;
    const startBlock = fromBlock ?? (lastScanned === undefined ? Math.max(0, endBlock - BATCH_SIZE) : lastScanned + 1);

    if (startBlock >= endBlock) return [];

    const entries: PayInEntry[] = [];
    let cursor = startBlock;
    let highestBlock = startBlock;

    while (cursor < endBlock) {
      const count = Math.min(BATCH_SIZE, endBlock - cursor);

      const result = isNative
        ? await this.payInInternetComputerService.getTransfers(cursor, count)
        : await this.payInInternetComputerService.getIcrcTransfers(canisterId, asset.decimals, cursor, count);

      for (const transfer of result.transfers) {
        const matchedAddress = addressLookup.get(transfer.to);
        if (!matchedAddress) continue;

        entries.push({
          senderAddresses: transfer.from,
          receiverAddress: BlockchainAddress.create(matchedAddress, this.blockchain),
          txId: isNative ? transfer.blockIndex.toString() : `${canisterId}:${transfer.blockIndex}`,
          txType: this.getTxType(matchedAddress),
          blockHeight: transfer.blockIndex,
          amount: transfer.amount,
          asset,
        });
      }

      highestBlock = Math.max(highestBlock, result.lastBlockIndex);

      // Advance cursor, handling stuck cursor edge case
      const nextCursor = result.lastBlockIndex + 1;
      if (nextCursor <= cursor) {
        this.logger.warn(`${asset.name}: cursor stuck at ${cursor}, skipping batch`);
        cursor += BATCH_SIZE;
      } else {
        cursor = nextCursor;
      }

      if (result.rawTransactionCount === 0) break;
    }

    // Update scan state
    if (highestBlock > (lastScanned ?? 0)) {
      scanState[stateKey] = highestBlock;
    }

    return entries;
  }

  // --- Settings persistence --- //
  private async getScanState(): Promise<Record<string, number>> {
    return (await this.settingService.getObj<Record<string, number>>(SETTING_KEY)) ?? {};
  }

  private async saveScanState(state: Record<string, number>): Promise<void> {
    await this.settingService.setObj(SETTING_KEY, state);
  }

  private getTxType(resolvedAddress: string): PayInType {
    return resolvedAddress === this.paymentAddress ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
