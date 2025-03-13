import { Inject, OnModuleInit } from '@nestjs/common';
import { AssetTransfersWithMetadataResult } from 'alchemy-sdk';
import { Config } from 'src/config/config';
import { AlchemyTransactionDto } from 'src/integration/alchemy/dto/alchemy-transaction.dto';
import { AlchemyTransactionMapper } from 'src/integration/alchemy/dto/alchemy-transaction.mapper';
import { AlchemyWebhookActivityDto, AlchemyWebhookDto } from 'src/integration/alchemy/dto/alchemy-webhook.dto';
import { AlchemyWebhookService } from 'src/integration/alchemy/services/alchemy-webhook.service';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Like } from 'typeorm';
import { PayInEntry } from '../../../../interfaces';
import { PayInEvmService } from '../../../../services/base/payin-evm.service';
import { RegisterStrategy } from './register.strategy';

export abstract class EvmStrategy extends RegisterStrategy implements OnModuleInit {
  protected addressWebhookMessageQueue: QueueHandler;
  protected assetTransfersMessageQueue: QueueHandler;

  private evmPaymentDepositAddress: string;

  @Inject() protected readonly alchemyWebhookService: AlchemyWebhookService;
  @Inject() protected readonly alchemyService: AlchemyService;
  @Inject() private readonly repos: RepositoryFactory;

  constructor(protected readonly payInEvmService: PayInEvmService) {
    super();
  }

  onModuleInit() {
    super.onModuleInit();

    this.evmPaymentDepositAddress = EvmUtil.createWallet({ seed: Config.payment.evmSeed, index: 0 }).address;
  }

  protected abstract getOwnAddresses(): string[];

  // --- WEBHOOKS --- //

  protected processAddressWebhookMessageQueue(dto: AlchemyWebhookDto): void {
    this.addressWebhookMessageQueue
      .handle<void>(async () => this.processWebhookTransactions(dto))
      .catch((e) => {
        this.logger.error(`Error while processing new pay-in entries with webhook dto ${JSON.stringify(dto)}:`, e);
      });
  }

  private async processWebhookTransactions(dto: AlchemyWebhookDto): Promise<void> {
    const fromAddresses = this.getOwnAddresses();
    const toAddresses = await this.getPayInAddresses();

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    const relevantTransactions = this.filterWebhookTransactionsByRelevantAddresses(fromAddresses, toAddresses, dto);
    const transactions = AlchemyTransactionMapper.mapWebhookActivities(relevantTransactions);

    const payInEntries = transactions.map((tx) => this.mapAlchemyTransaction(tx, supportedAssets)).filter((p) => p);

    if (payInEntries.length) {
      const log = this.createNewLogObject();
      await this.createPayInsAndSave(payInEntries, log);
    }
  }

  private filterWebhookTransactionsByRelevantAddresses(
    fromAddresses: string[],
    toAddresses: string[],
    dto: AlchemyWebhookDto,
  ): AlchemyWebhookActivityDto[] {
    const notFromOwnAddresses = dto.event.activity.filter(
      (tx) => !Util.includesIgnoreCase(fromAddresses, tx.fromAddress),
    );

    return notFromOwnAddresses.filter((tx) => Util.includesIgnoreCase(toAddresses, tx.toAddress));
  }

  // --- ASSET TRANSFERS --- //

  protected processAssetTransfersMessageQueue(assetTransfers: AssetTransfersWithMetadataResult[]): void {
    this.assetTransfersMessageQueue
      .handle<void>(async () => this.processAssetTransfers(assetTransfers))
      .catch((e) => {
        this.logger.error('Error while processing asset transfers:', e);
      });
  }

  private async processAssetTransfers(assetTransfers: AssetTransfersWithMetadataResult[]): Promise<void> {
    const fromAddresses = this.getOwnAddresses();
    const toAddresses = await this.getPayInAddresses();

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    const relevantAssetTransfers = this.filterAssetTransfersByRelevantAddresses(
      fromAddresses,
      toAddresses,
      assetTransfers,
    );
    const transactions = AlchemyTransactionMapper.mapAssetTransfers(relevantAssetTransfers);

    const payInEntries = transactions.map((tx) => this.mapAlchemyTransaction(tx, supportedAssets)).filter((p) => p);

    if (payInEntries.length) {
      const log = this.createNewLogObject();
      await this.createPayInsAndSave(payInEntries, log);
    }
  }

  private filterAssetTransfersByRelevantAddresses(
    fromAddresses: string[],
    toAddresses: string[],
    assetTransfers: AssetTransfersWithMetadataResult[],
  ): AssetTransfersWithMetadataResult[] {
    const notFromOwnAddresses = assetTransfers.filter((tx) => !Util.includesIgnoreCase(fromAddresses, tx.from));

    return notFromOwnAddresses.filter((tx) => Util.includesIgnoreCase(toAddresses, tx.to));
  }

  // --- HELPER METHODS --- //
  private async getPayInAddresses(): Promise<string[]> {
    const routes = await this.repos.depositRoute.find({
      where: { deposit: { blockchains: Like(`%${this.blockchain}%`) } },
      relations: ['deposit'],
    });

    const addresses = routes.map((dr) => dr.deposit.address);
    addresses.push(this.evmPaymentDepositAddress);

    return addresses;
  }

  private mapAlchemyTransaction(transaction: AlchemyTransactionDto, supportedAssets: Asset[]): PayInEntry | undefined {
    const rawValue = transaction.rawContract.rawValue;
    if (!rawValue || rawValue === '0x') return;

    return {
      senderAddresses: transaction.fromAddress,
      receiverAddress: BlockchainAddress.create(transaction.toAddress, this.blockchain),
      txId: transaction.hash,
      txType: this.getTxType(transaction.toAddress),
      blockHeight: Number(transaction.blockNum),
      amount: EvmUtil.fromWeiAmount(rawValue, transaction.rawContract.decimals),
      asset: this.getTransactionAsset(supportedAssets, transaction.rawContract.address) ?? null,
    };
  }

  private getTxType(address: string): PayInType | undefined {
    return Util.equalsIgnoreCase(this.evmPaymentDepositAddress, address) ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }

  private getTransactionAsset(supportedAssets: Asset[], chainId?: string): Asset | undefined {
    return chainId
      ? this.assetService.getByChainIdSync(supportedAssets, this.blockchain, chainId)
      : supportedAssets.find((a) => a.type === AssetType.COIN);
  }
}
