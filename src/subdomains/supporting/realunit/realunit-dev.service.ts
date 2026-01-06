import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Environment } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BankTxIndicator } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from '../bank/bank/bank.service';
import { IbanBankName } from '../bank/bank/dto/bank.dto';
import {
  TransactionRequest,
  TransactionRequestStatus,
  TransactionRequestType,
} from '../payment/entities/transaction-request.entity';
import { TransactionTypeInternal } from '../payment/entities/transaction.entity';
import { TransactionRequestRepository } from '../payment/repositories/transaction-request.repository';
import { SpecialExternalAccountService } from '../payment/services/special-external-account.service';
import { TransactionService } from '../payment/services/transaction.service';

@Injectable()
export class RealUnitDevService {
  private readonly logger = new DfxLogger(RealUnitDevService);

  constructor(
    private readonly transactionRequestRepo: TransactionRequestRepository,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly buyService: BuyService,
    private readonly bankTxService: BankTxService,
    private readonly bankService: BankService,
    private readonly specialAccountService: SpecialExternalAccountService,
    private readonly transactionService: TransactionService,
    private readonly buyCryptoRepo: BuyCryptoRepository,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(60)
  async simulateRealuPayments(): Promise<void> {
    if (![Environment.DEV, Environment.LOC].includes(Config.environment)) return;

    try {
      await this.processWaitingRealuRequests();
    } catch (e) {
      this.logger.error('Error in REALU payment simulation:', e);
    }
  }

  private async processWaitingRealuRequests(): Promise<void> {
    // TransactionRequests are created with Mainnet REALU (via realunit.service.ts)
    const mainnetRealuAsset = await this.assetService.getAssetByQuery({
      name: 'REALU',
      blockchain: Blockchain.ETHEREUM,
      type: AssetType.TOKEN,
    });

    // But payouts go to Sepolia in DEV environment
    const sepoliaRealuAsset = await this.assetService.getAssetByQuery({
      name: 'REALU',
      blockchain: Blockchain.SEPOLIA,
      type: AssetType.TOKEN,
    });

    if (!mainnetRealuAsset || !sepoliaRealuAsset) {
      this.logger.warn('REALU asset not found (mainnet or sepolia) - skipping simulation');
      return;
    }

    const waitingRequests = await this.transactionRequestRepo.find({
      where: {
        status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
        type: TransactionRequestType.BUY,
        targetId: mainnetRealuAsset.id,
      },
    });

    if (waitingRequests.length === 0) return;

    this.logger.info(`Found ${waitingRequests.length} waiting REALU transaction requests to simulate`);

    for (const request of waitingRequests) {
      try {
        await this.simulatePaymentForRequest(request, sepoliaRealuAsset);
      } catch (e) {
        this.logger.error(`Failed to simulate payment for TransactionRequest ${request.id}:`, e);
      }
    }
  }

  private async simulatePaymentForRequest(request: TransactionRequest, sepoliaRealuAsset: Asset): Promise<void> {
    // Get Buy route with user relation
    const buy = await this.buyService.getBuyByKey('id', request.routeId);
    if (!buy) {
      this.logger.warn(`Buy route ${request.routeId} not found for TransactionRequest ${request.id}`);
      return;
    }

    // Check if this TransactionRequest was already processed (prevent duplicate simulation)
    // We use the txInfo field to track which TransactionRequest a simulated BankTx belongs to
    const simulationMarker = `DEV simulation for TransactionRequest ${request.id}`;
    const existingBankTx = await this.bankTxService.getBankTxByKey('txInfo', simulationMarker);
    if (existingBankTx) {
      return;
    }

    // Get source currency
    const fiat = await this.fiatService.getFiat(request.sourceId);
    if (!fiat) {
      this.logger.warn(`Fiat ${request.sourceId} not found for TransactionRequest ${request.id}`);
      return;
    }

    // Get bank
    const bankName = fiat.name === 'CHF' ? IbanBankName.YAPEAL : IbanBankName.OLKY;
    const bank = await this.bankService.getBankInternal(bankName, fiat.name);
    if (!bank) {
      this.logger.warn(`Bank ${bankName} for ${fiat.name} not found - skipping simulation`);
      return;
    }

    // 1. Create BankTx
    const accountServiceRef = `DEV-SIM-${Util.createUid('SIM')}-${Date.now()}`;
    const multiAccounts = await this.specialAccountService.getMultiAccounts();

    const bankTx = await this.bankTxService.create(
      {
        accountServiceRef,
        bookingDate: new Date(),
        valueDate: new Date(),
        amount: request.amount,
        txAmount: request.amount,
        currency: fiat.name,
        txCurrency: fiat.name,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        remittanceInfo: buy.bankUsage,
        iban: 'CH0000000000000000000',
        name: 'DEV SIMULATION',
        accountIban: bank.iban,
        txInfo: `DEV simulation for TransactionRequest ${request.id}`,
      },
      multiAccounts,
    );

    // 2. Create BuyCrypto with amlCheck: PASS
    // Use Sepolia REALU asset for payout (not request.targetId which points to Mainnet)
    const buyCrypto = this.buyCryptoRepo.create({
      bankTx: { id: bankTx.id } as any,
      buy,
      inputAmount: request.amount,
      inputAsset: fiat.name,
      inputReferenceAmount: request.amount,
      inputReferenceAsset: fiat.name,
      outputAsset: sepoliaRealuAsset,
      outputReferenceAsset: sepoliaRealuAsset,
      amlCheck: CheckStatus.PASS,
      priceDefinitionAllowedDate: new Date(),
      transaction: { id: bankTx.transaction.id } as any,
    });

    await this.buyCryptoRepo.save(buyCrypto);

    // 3. Update Transaction type
    await this.transactionService.updateInternal(bankTx.transaction, {
      type: TransactionTypeInternal.BUY_CRYPTO,
      user: buy.user,
      userData: buy.user.userData,
    });

    // 4. Complete TransactionRequest
    await this.transactionRequestRepo.update(request.id, {
      isComplete: true,
      status: TransactionRequestStatus.COMPLETED,
    });

    this.logger.info(
      `DEV simulation complete for TransactionRequest ${request.id}: ${request.amount} ${fiat.name} -> REALU (BuyCrypto created with amlCheck: PASS)`,
    );
  }
}
