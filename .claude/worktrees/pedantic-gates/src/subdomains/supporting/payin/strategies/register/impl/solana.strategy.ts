import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { SolanaUtil } from 'src/integration/blockchain/solana/solana.util';
import { TatumWebhookDto } from 'src/integration/tatum/dto/tatum.dto';
import { TatumWebhookService } from 'src/integration/tatum/services/tatum-webhook.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { Like } from 'typeorm';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class SolanaStrategy extends RegisterStrategy implements OnModuleInit {
  protected logger: DfxLogger = new DfxLogger(SolanaStrategy);

  private addressWebhookMessageQueue: QueueHandler;

  private solanaPaymentDepositAddress: string;

  constructor(
    private readonly tatumWebhookService: TatumWebhookService,
    private readonly solanaService: SolanaService,
    private readonly repos: RepositoryFactory,
  ) {
    super();
  }

  onModuleInit() {
    super.onModuleInit();

    this.addressWebhookMessageQueue = new QueueHandler();

    this.tatumWebhookService
      .getAddressWebhookObservable()
      .subscribe((dto) => this.processAddressWebhookMessageQueue(dto));

    this.solanaPaymentDepositAddress = SolanaUtil.createWallet({ seed: Config.payment.solanaSeed, index: 0 }).address;
  }

  get blockchain(): Blockchain {
    return Blockchain.SOLANA;
  }

  private processAddressWebhookMessageQueue(dto: TatumWebhookDto): void {
    this.addressWebhookMessageQueue
      .handle<void>(async () => this.processWebhookTransactions(dto))
      .catch((e) => {
        this.logger.error(`Error while processing new pay-in entries with webhook dto ${JSON.stringify(dto)}:`, e);
      });
  }

  private async processWebhookTransactions(dto: TatumWebhookDto): Promise<void> {
    if (!dto.counterAddresses?.length) return;
    if (!Util.includesIgnoreCase(['native', 'token'], dto.type)) return;

    const ownWalletAddress = this.solanaService.getWalletAddress();
    const toAddresses = await this.getPayInAddresses();

    if (Util.includesIgnoreCase(dto.counterAddresses, ownWalletAddress)) return;
    if (!Util.includesIgnoreCase(toAddresses, dto.address)) return;

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    const payInEntry = this.mapSolanaTransaction(dto, supportedAssets);

    if (payInEntry) {
      const log = this.createNewLogObject();
      await this.createPayInsAndSave([payInEntry], log);
    }
  }

  private async getPayInAddresses(): Promise<string[]> {
    const routes = await this.repos.depositRoute.find({
      where: { deposit: { blockchains: Like(`%${this.blockchain}%`) } },
      relations: { deposit: true },
    });

    const addresses = routes.map((dr) => dr.deposit.address);
    addresses.push(this.solanaPaymentDepositAddress);

    return addresses;
  }

  private mapSolanaTransaction(dto: TatumWebhookDto, supportedAssets: Asset[]): PayInEntry | undefined {
    const isNativeTransaction = Util.equalsIgnoreCase('native', dto.type);

    return {
      senderAddresses: dto.counterAddresses.join(','),
      receiverAddress: BlockchainAddress.create(dto.address, this.blockchain),
      txId: dto.txId,
      txType: this.getTxType(dto.address),
      blockHeight: dto.blockNumber,
      amount: Number(dto.amount),
      asset: isNativeTransaction
        ? this.getTransactionCoin(supportedAssets)
        : this.getTransactionAsset(supportedAssets, dto.asset),
    };
  }

  private getTxType(address: string): PayInType | undefined {
    return Util.equalsIgnoreCase(this.solanaPaymentDepositAddress, address) ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }

  private getTransactionCoin(supportedAssets: Asset[]): Asset | undefined {
    return supportedAssets.find((a) => a.type === AssetType.COIN);
  }

  private getTransactionAsset(supportedAssets: Asset[], chainId?: string): Asset | undefined {
    return chainId
      ? this.assetService.getByChainIdSync(supportedAssets, this.blockchain, chainId)
      : this.getTransactionCoin(supportedAssets);
  }
}
