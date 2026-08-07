import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { toScorechainBlockchain } from 'src/integration/scorechain/dto/scorechain.dto';
import { ScorechainScreeningService } from 'src/integration/scorechain/services/scorechain-screening.service';
import { TransactionStatus } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { Active, isAsset, isFiat } from 'src/shared/models/active';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { AmountType, Util } from 'src/shared/utils/util';
import { AmlSourceType, TransactionAmlCheck } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { BlockAmlReasons } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { ScorechainOutcome } from 'src/subdomains/core/aml/enums/scorechain-outcome.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { ScorechainDocumentService } from 'src/subdomains/generic/kyc/services/scorechain-document.service';
import { KycStatus, RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { CardBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import {
  BankTx,
  BankTxType,
  BankTxUnassignedTypes,
} from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxOutgoingMatchService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-outgoing-match.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { CryptoPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { Price, PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EntityManager, FindOptionsWhere, In, IsNull, MoreThan, Not } from 'typeorm';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyCryptoFee } from '../entities/buy-crypto-fees.entity';
import { BuyCrypto, BuyCryptoStatus } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { BuyCryptoWebhookService } from './buy-crypto-webhook.service';
import { BuyCryptoService } from './buy-crypto.service';

@Injectable()
export class BuyCryptoPreparationService {
  private readonly logger = new DfxLogger(BuyCryptoPreparationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly amlService: AmlService,
    private readonly siftService: SiftService,
    private readonly countryService: CountryService,
    private readonly bankService: BankService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly virtualIbanService: VirtualIbanService,
    private readonly transactionService: TransactionService,
    private readonly scorechainScreeningService: ScorechainScreeningService,
    @Inject(forwardRef(() => ScorechainDocumentService))
    private readonly scorechainDocumentService: ScorechainDocumentService,
    private readonly transactionAmlCheckService: TransactionAmlCheckService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly bankTxOutgoingMatchService: BankTxOutgoingMatchService,
  ) {}

  // Scorechain on-chain screening for the AML gate. BuyCrypto withdrawal (fiat-funded) screens the
  // crypto-out target address; a swap (crypto-in) screens the incoming deposit tx. Chains Scorechain
  // does not cover yield no signal (the other AML mechanisms apply). isHighRisk is fail-closed for
  // deposits (invalid signature / no coverage / unsupported → high risk); a withdrawal to an address
  // with no coverage passes, since a fresh destination address has no data to assess.
  private async screenScorechain(entity: BuyCrypto): Promise<ScorechainOutcome> {
    // Feature gate / kill-switch: when Scorechain is disabled or unconfigured (no API key), emit no
    // signal so the tx is decided by the other AML mechanisms. This is the deliberate off-state and
    // must never route an unscreened-because-off tx to manual review.
    if (DisabledProcess(Process.SCORECHAIN) || !Config.scorechain.apiKey) return ScorechainOutcome.PASS;

    const [blockchain, objectId, isDeposit] = entity.cryptoInput
      ? [entity.cryptoInput.asset.blockchain, entity.cryptoInput.inTxId, true]
      : [entity.outputAsset.blockchain, entity.targetAddress, false];

    if (!objectId || !toScorechainBlockchain(blockchain)) return ScorechainOutcome.PASS;

    try {
      // Compliance has reviewed this account's Scorechain findings with the customer and released them
      // (`scorechainCheckDate`, valid for a limited time — see `hasValidScorechainReview`). The on-chain
      // verdict never changes for a permanently tainted source, so without this every further deposit
      // would be routed to the same manual review again.
      //
      // DEPOSITS ONLY. The withdrawal screening asks a different question — may DFX pay INTO this
      // address — which a review of the customer's funding source does not answer; a payout to a listed
      // address must never be waved through by it. Payouts have their own, address-scoped exemption below.
      //
      // Deliberately NOT fail-closed on a missing userData: no account means no review, so the screening
      // runs. Inside the try on purpose: like every other userData access here, a failure must become
      // UNAVAILABLE (manual review), never an exception that leaves the transaction without a verdict.
      if (isDeposit && entity.userData?.hasValidScorechainReview) {
        this.logger.info(
          `Skipping Scorechain screening for buy-crypto ${entity.id}: account ${entity.userData.id} reviewed by compliance`,
        );
        return ScorechainOutcome.PASS;
      }

      // A compliance-exempted target address (manually reviewed high-risk verdict, e.g. third-party
      // address poisoning against a customer wallet) skips the billable withdrawal screening — the
      // unchanged on-chain score would otherwise re-route every payout to the same address into the
      // same manual review. Managed via SpecialExternalAccount type ScorechainExemptAddress.
      if (!isDeposit && (await this.amlService.isScorechainExemptAddress(objectId))) {
        this.logger.verbose(`Scorechain screening skipped for buy-crypto ${entity.id}: target address is exempted`);
        return ScorechainOutcome.PASS;
      }

      const screening = isDeposit
        ? await this.scorechainScreeningService.screenDepositTransaction(blockchain, objectId)
        : await this.scorechainScreeningService.screenWithdrawalAddress(blockchain, objectId);

      // Persist a compliance report for every fresh (non-cached) screening tied to a customer.
      // createScreeningReport never throws (it swallows+logs), so it cannot affect the AML verdict.
      if (screening.isNewlyScreened && entity.userData)
        await this.scorechainDocumentService.createScreeningReport(entity.userData, screening);

      return this.scorechainScreeningService.isHighRisk(screening)
        ? ScorechainOutcome.HIGH_RISK
        : ScorechainOutcome.PASS;
    } catch (e) {
      // Fail-closed to manual review: a provider/transport error or a reached monthly quota must not
      // throw out of the AML computation (which would silently stall settlement of every otherwise-
      // passing tx on every cron run).
      // Classify as UNAVAILABLE, never HIGH_RISK: no risk verdict could be established. A transport or quota
      // error leaves no screening row and no compliance PDF at all; a missing risk threshold throws only
      // after both have been persisted. In neither case may the tx be recorded as an actual Scorechain hit.
      this.logger.error(`Scorechain screening unavailable for buy-crypto ${entity.id}, routing to manual review:`, e);
      return ScorechainOutcome.UNAVAILABLE;
    }
  }

  async doAmlCheck(): Promise<void> {
    // selection mirrored by BuyCrypto.isAmlPricingPending (ledger gate-block) — keep in sync
    const request: FindOptionsWhere<BuyCrypto> = {
      inputAmount: Not(IsNull()),
      inputAsset: Not(IsNull()),
      chargebackAllowedDate: IsNull(),
      chargebackAllowedDateUser: IsNull(),
      isComplete: false,
    };
    const entities = await this.buyCryptoRepo.find({
      where: [
        {
          amlCheck: IsNull(),
          amlReason: IsNull(),
          ...request,
        },
        { amlCheck: CheckStatus.PENDING, amlReason: Not(In(BlockAmlReasons)), ...request },
        // Retry a PASS whose post-processing did not complete (transient failure) so its compliance
        // side-effects are not silently lost; postProcessing is idempotent, so re-running is safe.
        { amlCheck: CheckStatus.PASS, amlPostProcessed: false, ...request },
      ],
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: { asset: { balance: true, liquidityManagementRule: true } },
        buy: true,
        cryptoRoute: true,
        transaction: { user: { wallet: true }, userData: true },
        bankData: true,
      },
    });
    if (entities.length === 0) return;

    this.logger.verbose(
      `AmlCheck for ${entities.length} buy-crypto transaction(s). Transaction ID(s): ${entities.map((t) => t.id)}`,
    );

    for (const entity of entities) {
      try {
        if (entity.cryptoInput && !entity.cryptoInput.isConfirmed) continue;

        const amlCheckBefore = entity.amlCheck;
        const amlReasonBefore = entity.amlReason;
        const isFirstRun = entity.amlCheck == null;

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));
        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const isPayment = Boolean(entity.cryptoInput?.isPayment);
        const minVolume = await this.transactionHelper.getMinVolume(
          inputCurrency,
          entity.outputAsset,
          inputReferenceCurrency,
          PriceValidity.VALID_ONLY,
          isPayment,
        );

        const {
          users,
          refUser,
          recommender,
          bankData,
          blacklist,
          phoneCallList,
          banks,
          ipLogCountries,
          multiAccountBankNames,
        } = await this.amlService.getAmlCheckInput(entity);
        if (!users.length || (bankData && bankData.status === ReviewStatus.INTERNAL_REVIEW)) continue;

        const referenceChfPrice = await this.pricingService.getPrice(
          inputReferenceCurrency,
          PriceCurrency.CHF,
          PriceValidity.VALID_ONLY,
        );
        const referenceEurPrice = await this.pricingService.getPrice(
          inputReferenceCurrency,
          PriceCurrency.EUR,
          PriceValidity.VALID_ONLY,
        );

        const last7dCheckoutVolume = await this.transactionHelper.getVolumeChfSince(
          entity,
          users,
          Util.daysBefore(7, entity.transaction.created),
          Util.daysAfter(7, entity.transaction.created),
          PriceValidity.VALID_ONLY,
          'checkoutTx',
          referenceChfPrice,
        );

        const last30dVolume = await this.transactionHelper.getVolumeChfSince(
          entity,
          users,
          Util.daysBefore(30, entity.transaction.created),
          Util.daysAfter(30, entity.transaction.created),
          PriceValidity.VALID_ONLY,
          undefined,
          referenceChfPrice,
        );

        // Retry path: this row is already PASS but its post-processing did not complete — a transient
        // cron failure, or a manual reviewer / other path that committed PASS without finishing
        // post-processing. Re-run post-processing ONLY; never recompute the verdict here, so a committed
        // PASS (including a human reviewer's decision) is never reverted, re-screened or re-billed.
        if (entity.amlCheck === CheckStatus.PASS && !entity.amlPostProcessed) {
          await this.postProcessAmlVerdict(entity, last30dVolume, isFirstRun);
          continue;
        }

        const last365dVolume = await this.transactionHelper.getVolumeChfSince(
          entity,
          users,
          Util.daysBefore(365, entity.transaction.created),
          Util.daysAfter(365, entity.transaction.created),
          PriceValidity.VALID_ONLY,
          undefined,
          referenceChfPrice,
        );

        const ibanCountryCode = entity.bankTx?.iban?.substring(0, 2) ?? entity.checkoutTx?.cardIssuerCountry;
        const ibanCountry = ibanCountryCode
          ? await this.countryService.getCountryWithSymbol(ibanCountryCode)
          : undefined;

        const virtualIban = entity.bankTx?.virtualIban
          ? await this.virtualIbanService.getByIban(entity.bankTx.virtualIban)
          : undefined;

        const [id, update] = await entity.amlCheckAndFillUp(
          inputCurrency,
          minVolume,
          referenceEurPrice.convert(entity.inputReferenceAmount, 2),
          referenceChfPrice.convert(entity.inputReferenceAmount, 2),
          last7dCheckoutVolume,
          last30dVolume,
          last365dVolume,
          bankData,
          blacklist,
          phoneCallList,
          banks,
          ibanCountry,
          refUser,
          recommender,
          ipLogCountries,
          virtualIban,
          multiAccountBankNames,
          () => this.screenScorechain(entity),
        );

        // Atomic guard: persist only if amlCheck is unchanged since it was read, so a concurrent manual
        // reviewer / refund / reset (NULL or PENDING) is never silently overwritten by the cron.
        const versionBefore = entity.version;
        const statusBefore = entity.status;
        const wasUpdated = await this.persistAmlDecision(
          entity,
          id,
          update,
          versionBefore,
          statusBefore,
          amlCheckBefore,
          amlReasonBefore,
        );
        if (!wasUpdated) continue;
        if (versionBefore !== undefined) entity.version = versionBefore + 1;

        if (!(await this.postProcessAmlVerdict(entity, last30dVolume, isFirstRun, amlCheckBefore))) continue;
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} AML check:`, e);
      }
    }
  }

  private async postProcessAmlVerdict(
    entity: BuyCrypto,
    last30dVolume: number,
    isFirstRun: boolean,
    amlCheckBefore = entity.amlCheck,
  ): Promise<boolean> {
    return this.buyCryptoRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOne(BuyCrypto, {
        where: {
          id: entity.id,
          version: entity.version,
          status: entity.status,
          amlCheck: entity.amlCheck,
          amlReason: entity.amlReason == null ? IsNull() : entity.amlReason,
          isComplete: false,
        },
        select: { id: true },
        loadEagerRelations: false,
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) return false;

      await this.amlService.postProcessing(entity, last30dVolume, isFirstRun);

      if (entity.amlCheck === CheckStatus.PASS) {
        const result = await manager.update(
          BuyCrypto,
          {
            id: entity.id,
            version: entity.version,
            status: entity.status,
            amlCheck: CheckStatus.PASS,
            amlPostProcessed: false,
            isComplete: false,
          },
          { amlPostProcessed: true },
        );
        if (result.affected !== 1) return false;
        entity.amlPostProcessed = true;
        if (entity.version !== undefined) entity.version += 1;
      }

      if (amlCheckBefore !== entity.amlCheck) await this.buyCryptoWebhookService.triggerWebhook(entity);
      if (entity.amlCheck === CheckStatus.PASS && amlCheckBefore === CheckStatus.PENDING)
        await this.buyCryptoNotificationService.paymentProcessing(entity, manager);
      if (entity.amlCheck === CheckStatus.FAIL)
        await this.siftService.buyCryptoTransaction(entity, TransactionStatus.FAILURE);

      return true;
    });
  }

  private async persistAmlDecision(
    entity: BuyCrypto,
    id: number,
    update: Partial<BuyCrypto>,
    versionBefore: number,
    statusBefore: BuyCryptoStatus,
    amlCheckBefore: CheckStatus | undefined,
    amlReasonBefore: BuyCrypto['amlReason'],
  ): Promise<boolean> {
    return this.buyCryptoRepo.manager.transaction(async (manager) => {
      const { affected } = await manager.update(
        BuyCrypto,
        {
          id,
          version: versionBefore,
          status: statusBefore,
          isComplete: false,
          amlCheck: amlCheckBefore == null ? IsNull() : amlCheckBefore,
        },
        update,
      );
      if (!affected) return false;

      if (amlCheckBefore !== entity.amlCheck || amlReasonBefore !== entity.amlReason) {
        const audit = manager.create(TransactionAmlCheck, {
          transaction: entity.transaction,
          entityType: 'BuyCrypto',
          entityId: entity.id,
          source: AmlSourceType.AML_CHECK_CRON,
          previousAmlCheck: amlCheckBefore,
          amlCheck: entity.amlCheck,
          previousAmlReason: amlReasonBefore,
          amlReason: entity.amlReason,
          amlResponsible: entity.amlResponsible,
          comment: entity.comment,
          priceDefinitionAllowedDate: entity.priceDefinitionAllowedDate,
          highRisk: entity.highRisk,
        });
        await manager.save(TransactionAmlCheck, audit);
      }
      return true;
    });
  }

  private async saveAmlAudit(
    manager: EntityManager,
    entity: BuyCrypto,
    source: AmlSourceType,
    previousAmlCheck?: CheckStatus,
    previousAmlReason?: BuyCrypto['amlReason'],
  ): Promise<void> {
    if (previousAmlCheck === entity.amlCheck && previousAmlReason === entity.amlReason) return;

    const audit = manager.create(TransactionAmlCheck, {
      transaction: entity.transaction,
      entityType: 'BuyCrypto',
      entityId: entity.id,
      source,
      previousAmlCheck,
      amlCheck: entity.amlCheck,
      previousAmlReason,
      amlReason: entity.amlReason,
      amlResponsible: entity.amlResponsible,
      comment: entity.comment,
      priceDefinitionAllowedDate: entity.priceDefinitionAllowedDate,
      highRisk: entity.highRisk,
    });
    await manager.save(TransactionAmlCheck, audit);
  }

  async refreshFee(): Promise<void> {
    const request: FindOptionsWhere<BuyCrypto> = {
      amlCheck: CheckStatus.PASS,
      status: Not(
        In([
          BuyCryptoStatus.READY_FOR_PAYOUT,
          BuyCryptoStatus.PAYING_OUT,
          BuyCryptoStatus.COMPLETE,
          BuyCryptoStatus.STOPPED,
        ]),
      ),
      isComplete: false,
      inputReferenceAmount: Not(IsNull()),
      cryptoInput: { paymentLinkPayment: { id: IsNull() } },
    };
    const entities = await this.buyCryptoRepo.find({
      where: [
        {
          outputAsset: { type: Not(AssetType.PRESALE) },
          ...request,
        },
        { percentFee: IsNull(), ...request },
      ],
      relations: {
        bankTx: true,
        checkoutTx: true,
        cryptoInput: true,
        buy: true,
        cryptoRoute: true,
        transaction: { user: { wallet: true, userData: true }, userData: true },
      },
    });

    for (const entity of entities) {
      try {
        const isFirstRun = entity.percentFee == null;

        const inputReferenceCurrency =
          entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputReferenceAsset));

        const inputCurrency = entity.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(entity.inputAsset));

        const referenceEurPrice = await this.pricingService.getPrice(
          inputReferenceCurrency,
          PriceCurrency.EUR,
          PriceValidity.VALID_ONLY,
        );
        const referenceChfPrice = await this.pricingService.getPrice(
          inputReferenceCurrency,
          PriceCurrency.CHF,
          PriceValidity.VALID_ONLY,
        );

        const amountInChf = referenceChfPrice.convert(entity.inputReferenceAmount, 2);

        const bankIn = entity.bankTx
          ? await this.bankService.getBankByIban(entity.bankTx.accountIban).then((b) => b?.name)
          : entity.checkoutTx
            ? CardBankName.CHECKOUT
            : undefined;

        const fee = await this.transactionHelper.getTxFeeInfos(
          entity.inputReferenceAmount,
          amountInChf,
          inputCurrency,
          inputReferenceCurrency,
          entity.outputAsset,
          entity.paymentMethodIn,
          CryptoPaymentMethod.CRYPTO,
          bankIn,
          undefined,
          entity.user,
        );

        const maxNetworkFee = fee.network ? fee.network : referenceChfPrice.invert().convert(Config.maxBlockchainFee);
        const maxNetworkFeeInOutAsset = await this.convertNetworkFee(
          inputReferenceCurrency,
          entity.outputAsset,
          maxNetworkFee,
        );
        const amlCheckBefore = entity.amlCheck;
        const amlReasonBefore = entity.amlReason;
        const statusBefore = entity.status;
        const versionBefore = entity.version;
        const [, feeAndFiatUpdate] = entity.setFeeAndFiatReference(
          fee,
          isFiat(inputReferenceCurrency) ? fee.min : referenceEurPrice.convert(fee.min, 2),
          referenceChfPrice.convert(fee.total, 2),
        );

        const wasUpdated = await this.buyCryptoRepo.manager.transaction(async (manager) => {
          const locked = await manager.findOne(BuyCrypto, {
            where: { id: entity.id },
            select: { id: true },
            loadEagerRelations: false,
            lock: { mode: 'pessimistic_write' },
          });
          if (!locked) return false;

          const current = await manager.findOne(BuyCrypto, {
            where: { id: entity.id },
            relations: { fee: true },
          });
          if (
            !current ||
            current.version !== versionBefore ||
            current.amlCheck !== amlCheckBefore ||
            current.status !== statusBefore ||
            current.isComplete ||
            current.batch
          )
            return false;

          const feeConstraints = current.fee ?? (await manager.save(BuyCryptoFee, BuyCryptoFee.create(current)));
          await manager.update(BuyCryptoFee, feeConstraints.id, {
            allowedTotalFeeAmount: maxNetworkFeeInOutAsset,
          });

          const result = await manager.update(
            BuyCrypto,
            {
              id: entity.id,
              version: versionBefore,
              amlCheck: amlCheckBefore,
              status: statusBefore,
              isComplete: false,
              batch: IsNull(),
            },
            feeAndFiatUpdate,
          );
          if (result.affected !== 1) return false;
          await this.saveAmlAudit(manager, entity, AmlSourceType.FEE_TOO_HIGH, amlCheckBefore, amlReasonBefore);
          return true;
        });
        if (!wasUpdated) continue;

        if (entity.feeAmountChf != null) {
          await this.transactionService.updateInternal(entity.transaction, { feeAmountInChf: entity.feeAmountChf });
        }

        if (entity.amlCheck === CheckStatus.FAIL) {
          // create sift transaction (non-blocking)
          void this.siftService.buyCryptoTransaction(entity, TransactionStatus.FAILURE);
          return;
        }

        if (isFirstRun) {
          await this.buyCryptoService.updateBuyVolume([entity.buy?.id]);
          await this.buyCryptoService.updateCryptoRouteVolume([entity.cryptoRoute?.id]);
          await this.buyCryptoService.updateRefVolume([entity.usedRef, entity.usedPartnerRef]);
        }
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }

  async fillPaymentLinkPayments(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        percentFee: IsNull(),
        amlCheck: CheckStatus.PASS,
        status: Not(
          In([
            BuyCryptoStatus.READY_FOR_PAYOUT,
            BuyCryptoStatus.PAYING_OUT,
            BuyCryptoStatus.COMPLETE,
            BuyCryptoStatus.STOPPED,
          ]),
        ),
        isComplete: false,
        inputReferenceAmount: Not(IsNull()),
        cryptoInput: { paymentLinkPayment: { id: Not(IsNull()) }, status: PayInStatus.COMPLETED },
      },

      relations: {
        transaction: { userData: true },
        cryptoInput: { paymentLinkPayment: { link: { route: { user: { userData: true } } } }, paymentQuote: true },
        cryptoRoute: true,
      },
    });

    const entitiesToPayout = entities
      .filter((bc) => !bc.userData.paymentLinksConfigObj.requiresConfirmation || bc.paymentLinkPayment?.isConfirmed)
      .filter(
        (bc) =>
          !bc.userData.paymentLinksConfigObj.requiresExplicitPayoutRoute ||
          bc.paymentLinkPayment?.link.linkConfigObj.payoutRouteId != null,
      );

    for (const entity of entitiesToPayout) {
      try {
        const invoiceAmount = entity.cryptoInput.paymentLinkPayment.amount;
        const invoiceCurrency = entity.paymentLinkPayment.currency;
        const inputCurrency = entity.cryptoInput.asset;
        const outputCurrency = entity.outputAsset;

        const outputPrice = await this.pricingService.getPriceAt(
          invoiceCurrency,
          outputCurrency,
          entity.cryptoInput.created,
        );
        const outputReferenceAmount = Util.roundReadable(outputPrice.convert(invoiceAmount), AmountType.ASSET);

        // fees
        const feeRate = Config.payment.forexFee(
          entity.cryptoInput.paymentQuote.standard,
          invoiceCurrency,
          inputCurrency,
        );
        const totalFee = entity.inputReferenceAmount * feeRate;
        const inputReferenceAmountMinusFee = entity.inputReferenceAmount - totalFee;

        const { fee: paymentLinkFee } = entity.paymentLinkPayment.link.configObj;

        // prices
        const eurPrice = await this.pricingService.getPrice(inputCurrency, PriceCurrency.EUR, PriceValidity.VALID_ONLY);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, PriceCurrency.CHF, PriceValidity.VALID_ONLY);

        const conversionPrice = Price.create(
          inputCurrency.name,
          invoiceCurrency.name,
          inputReferenceAmountMinusFee / invoiceAmount,
        );

        const conversionStep = PriceStep.create(
          Config.priceSourcePayment,
          conversionPrice.source,
          conversionPrice.target,
          conversionPrice.price,
          entity.cryptoInput.paymentQuote.created,
        );

        const outputStep = PriceStep.create(
          Config.priceSourceManual,
          outputPrice.source,
          outputPrice.target,
          outputPrice.price,
          outputPrice.timestamp,
        );

        const maxNetworkFee = chfPrice.invert().convert(Config.maxBlockchainFee);
        const maxNetworkFeeInOutAsset = await this.convertNetworkFee(inputCurrency, entity.outputAsset, maxNetworkFee);
        const amlCheckBefore = entity.amlCheck;
        const amlReasonBefore = entity.amlReason;
        const statusBefore = entity.status;
        const versionBefore = entity.version;
        const [, paymentLinkUpdate] = entity.setPaymentLinkPayment(
          eurPrice.convert(entity.inputAmount, 2),
          chfPrice.convert(entity.inputAmount, 2),
          feeRate,
          totalFee,
          chfPrice.convert(totalFee, 5),
          inputReferenceAmountMinusFee,
          outputReferenceAmount,
          paymentLinkFee,
          [conversionStep, outputStep],
        );

        const wasUpdated = await this.buyCryptoRepo.manager.transaction(async (manager) => {
          const locked = await manager.findOne(BuyCrypto, {
            where: { id: entity.id },
            select: { id: true },
            loadEagerRelations: false,
            lock: { mode: 'pessimistic_write' },
          });
          if (!locked) return false;

          const current = await manager.findOne(BuyCrypto, {
            where: { id: entity.id },
            relations: { fee: true },
          });
          if (
            !current ||
            current.version !== versionBefore ||
            current.amlCheck !== amlCheckBefore ||
            current.status !== statusBefore ||
            current.isComplete ||
            current.batch
          )
            return false;

          const feeConstraints = current.fee ?? (await manager.save(BuyCryptoFee, BuyCryptoFee.create(current)));
          await manager.update(BuyCryptoFee, feeConstraints.id, {
            allowedTotalFeeAmount: maxNetworkFeeInOutAsset,
          });

          const result = await manager.update(
            BuyCrypto,
            {
              id: entity.id,
              version: versionBefore,
              amlCheck: amlCheckBefore,
              status: statusBefore,
              isComplete: false,
              batch: IsNull(),
            },
            paymentLinkUpdate,
          );
          if (result.affected !== 1) return false;
          await this.saveAmlAudit(manager, entity, AmlSourceType.FEE_TOO_HIGH, amlCheckBefore, amlReasonBefore);
          return true;
        });
        if (!wasUpdated) continue;

        if (entity.feeAmountChf != null) {
          await this.transactionService.updateInternal(entity.transaction, { feeAmountInChf: entity.feeAmountChf });
        }

        if (entity.amlCheck === CheckStatus.FAIL) return;

        await this.buyCryptoService.updateCryptoRouteVolume([entity.cryptoRoute.id]);
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} fill paymentLinkPayments:`, e);
      }
    }
  }

  async checkAggregatingTransactions(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: { status: BuyCryptoStatus.PENDING_AGGREGATION },
      relations: { transaction: { user: true } },
    });

    const groups = Util.groupByAccessor(entities, (e) => `${e.targetAddress}-${e.outputAsset.id}`);

    for (const transactions of groups.values()) {
      const blockchain = transactions[0].outputAsset.blockchain;
      const totalAmount = Util.sumObjValue(transactions, 'amountInChf');
      if (totalAmount >= Config.payment.cryptoPayoutMinAmount(blockchain)) {
        await this.buyCryptoRepo.update(
          transactions.map((t) => t.id),
          { status: BuyCryptoStatus.CREATED },
        );
      }
    }
  }

  // Keep in sync with BuyCrypto.getChargebackBlockReasons() promotion conditions.
  async chargebackTx(): Promise<void> {
    const baseRequest: FindOptionsWhere<BuyCrypto> = {
      chargebackAllowedDate: IsNull(),
      chargebackAllowedDateUser: Not(IsNull()),
      chargebackAmount: Not(IsNull()),
      // a refund that already left the bank (externally executed and matched, or linked manually)
      // must never be paid again by the automatic promotion
      chargebackDate: IsNull(),
      chargebackBankTx: IsNull(),
      isComplete: false,
      transaction: {
        userData: {
          kycStatus: In([KycStatus.NA, KycStatus.CHECK, KycStatus.COMPLETED]),
          status: Not(UserDataStatus.BLOCKED),
          riskStatus: In([RiskStatus.NA, RiskStatus.RELEASED]),
        },
        user: { status: In([UserStatus.NA, UserStatus.ACTIVE]) },
      },
    };
    const entities = await this.buyCryptoRepo.find({
      where: [
        {
          ...baseRequest,
          bankTx: { id: Not(IsNull()) },
          chargebackIban: Not(IsNull()),
          chargebackCreditorData: Not(IsNull()),
        },
        { ...baseRequest, checkoutTx: { id: Not(IsNull()) } },
        { ...baseRequest, cryptoInput: { id: Not(IsNull()) }, chargebackIban: Not(IsNull()) },
      ],
      relations: { checkoutTx: true, bankTx: true, cryptoInput: true, transaction: { userData: true } },
    });

    for (const entity of entities) {
      try {
        const chargebackAllowedDate = new Date();
        const chargebackAllowedBy = 'API';
        const chargebackAllowedDateUser = entity.chargebackAllowedDateUser;

        if (entity.bankTx) {
          if (
            Util.matchesCreditorName(
              entity.userData.verifiedName,
              entity.userData.completeName,
              entity.creditorData.name,
            )
          )
            await this.buyCryptoService.refundBankTx(entity, {
              chargebackAllowedDate,
              chargebackAllowedDateUser,
              chargebackAllowedBy,
            });
          else
            this.logger.warn(
              `BuyCrypto ${entity.id} waiting for manual chargeback approval due to creditor name mismatch`,
            );
        } else if (entity.cryptoInput) {
          await this.buyCryptoService.refundCryptoInput(entity, {
            chargebackAllowedDate,
            chargebackAllowedDateUser,
            chargebackAllowedBy,
          });
        } else {
          await this.buyCryptoService.refundCheckoutTx(entity, {
            chargebackAllowedDate,
            chargebackAllowedDateUser,
            chargebackAllowedBy,
          });
        }
      } catch (e) {
        this.logger.error(`Failed to chargeback buy-crypto ${entity.id}:`, e);
      }
    }
  }

  async chargebackFillUp(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        chargebackBankTx: IsNull(),
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        chargebackOutput: { isComplete: true, bankTx: { id: Not(IsNull()) } },
      },
      relations: {
        transaction: { user: { wallet: true }, userData: true },
        chargebackOutput: { bankTx: true },
        // cryptoInput and bankTx are read by triggerWebhook (tx type / sourceAccount);
        // load explicitly for a complete payload instead of relying on the filter
        cryptoInput: true,
        bankTx: true,
      },
    });

    for (const entity of entities) {
      try {
        await this.buyCryptoRepo.update(entity.id, {
          chargebackBankTx: entity.chargebackOutput.bankTx,
          isComplete: true,
          status: BuyCryptoStatus.COMPLETE,
        });

        // send webhook
        await this.buyCryptoWebhookService.triggerWebhook(entity);
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} chargeback fillUp:`, e);
      }
    }
  }

  // Matches failed buy-cryptos that were refunded directly at the bank (no fiat_output, no
  // remittance reference) to the outgoing bank TX, so the refund is documented on the transaction
  // and can never be paid a second time. Claim-first: the chargeback marks are written via a guarded
  // UPDATE (all chargeback fields still NULL) before the bank TX is typed - a concurrent manual
  // chargeback loses exactly one of the two races, never both. The DB-side backstop is the UNIQUE
  // constraint on buy_crypto.chargebackBankTxId. The claim completes the entity like the regular
  // chargebackFillUp (isComplete/COMPLETE + webhook + chargeback mail): the ledger opens
  // buyCrypto-owed on completion and closes it on the BuyCryptoReturn typing of the DBIT - one
  // without the other leaves owed permanently open. Known residual window: a user refund request
  // promoted by chargebackTx() while the external DBIT is still inside the matcher's maturity
  // delay can still double-pay - the guards only bite once the DBIT is claimable and linked.
  async matchExternalChargebacks(): Promise<void> {
    const request: FindOptionsWhere<BuyCrypto> = {
      amlCheck: CheckStatus.FAIL,
      isComplete: false,
      batch: IsNull(),
      outputAmount: IsNull(),
      // the ledger consumers anchor both owed legs on amountInChf and fail loud without it
      amountInChf: Not(IsNull()),
      chargebackOutput: IsNull(),
      chargebackAllowedDate: IsNull(),
      chargebackDate: IsNull(),
      chargebackCryptoTxId: IsNull(),
      chargebackBankTx: IsNull(),
      created: MoreThan(Util.daysBefore(90)),
    };
    const entities = await this.buyCryptoRepo.find({
      where: { ...request, bankTx: { id: Not(IsNull()) } },
      relations: {
        bankTx: true,
        cryptoInput: true,
        checkoutTx: true,
        chargebackOutput: true,
        transaction: { user: { wallet: true, userData: true }, userData: true },
      },
    });

    // collect first, claim second: an IBAN-less DBIT that fits several candidates (same amount from
    // two customers) must not be claimed first-come-first-served
    const matched: { entity: BuyCrypto; chargebackTx: BankTx; matchAmount: number }[] = [];
    for (const entity of entities) {
      try {
        // the bank refunds the deposit, so match its amount; a prepared chargebackAmount only
        // overrides it when denominated in the deposit currency
        const matchAmount =
          entity.chargebackAsset && entity.chargebackAsset !== entity.bankTx.currency
            ? entity.bankTx.amount
            : (entity.chargebackAmount ?? entity.bankTx.amount);
        const chargebackTx = await this.bankTxOutgoingMatchService.getUniqueExternalChargebackBankTx({
          counterpartyIban: entity.bankTx.iban,
          accountIban: entity.bankTx.accountIban,
          amount: matchAmount,
          currency: entity.bankTx.currency,
          earliestDate: entity.bankTx.created,
        });
        if (chargebackTx) matched.push({ entity, chargebackTx, matchAmount });
      } catch (e) {
        this.logger.error(`Failed to match external chargeback for buy-crypto ${entity.id}:`, e);
      }
    }

    const matchCounts = new Map<number, number>();
    for (const { chargebackTx } of matched) {
      matchCounts.set(chargebackTx.id, (matchCounts.get(chargebackTx.id) ?? 0) + 1);
    }

    for (const { entity, chargebackTx, matchAmount } of matched) {
      if (matchCounts.get(chargebackTx.id) > 1) {
        // stays in the unassigned bank TX list for manual assignment
        this.logger.info(
          `Skipping ambiguous external chargeback bank TX ${chargebackTx.id} (fits multiple failed buy-cryptos)`,
        );
        continue;
      }

      try {
        const update: Partial<BuyCrypto> = {
          chargebackBankTx: chargebackTx,
          chargebackDate: chargebackTx.created,
          chargebackAllowedDate: chargebackTx.created,
          chargebackAllowedBy: 'API (bank TX match)',
          chargebackAmount: matchAmount,
          chargebackAsset: chargebackTx.currency,
          chargebackIban: chargebackTx.iban ?? entity.bankTx.iban,
          chargebackRemittanceInfo: chargebackTx.remittanceInfo?.substring(0, 256),
          // mail + completion mirror the regular chargeback path (chargebackInitiated mail keys on
          // chargebackAllowedDate + mailSendDate)
          mailSendDate: null,
          isComplete: true,
          status: BuyCryptoStatus.COMPLETE,
        };
        const claim = await this.buyCryptoRepo.update(
          {
            id: entity.id,
            amlCheck: CheckStatus.FAIL,
            isComplete: false,
            batch: IsNull(),
            outputAmount: IsNull(),
            chargebackOutput: IsNull(),
            chargebackAllowedDate: IsNull(),
            chargebackAllowedDateUser: entity.chargebackAllowedDateUser ?? IsNull(),
            chargebackDate: IsNull(),
            chargebackCryptoTxId: IsNull(),
            chargebackBankTx: IsNull(),
          },
          update,
        );
        if (claim.affected !== 1) continue;

        await this.bankTxService.updateInternal(
          chargebackTx,
          { type: BankTxType.BUY_CRYPTO_RETURN },
          entity.transaction?.user,
        );
        this.logger.info(`Matched external chargeback bank TX ${chargebackTx.id} to buy-crypto ${entity.id}`);

        try {
          await this.buyCryptoWebhookService.triggerWebhook(Object.assign(entity, update));
        } catch (e) {
          this.logger.error(`Failed to trigger webhook for externally charged-back buy-crypto ${entity.id}:`, e);
        }
      } catch (e) {
        this.logger.error(`Failed to match external chargeback for buy-crypto ${entity.id}:`, e);
      }
    }

    // heal pass: chargeback bank TX linked (by this cron or manually via chargebackBankTxId), but
    // typing it failed or was skipped - without the type, accounting and the assign cron would keep
    // treating the booked refund as an open pending TX. Only entities in the state the ledger
    // expects are typed (complete + priced): the BuyCryptoReturn booking debits owed against the
    // completion opening and hard-fails without amountInChf - a manual link on an incomplete or
    // unpriced entity stays visibly untyped until the entity is completed in the tool.
    const healBase: FindOptionsWhere<BuyCrypto> = { isComplete: true, amountInChf: Not(IsNull()) };
    // the window is measured on the DBIT (always recent when a refund was just booked or linked),
    // not on the buy-crypto - a manual link on an old entity must still be healed
    const healWindow = MoreThan(Util.daysBefore(90));
    const unhealed = await this.buyCryptoRepo.find({
      where: [
        // id guard: without it, the LEFT JOIN would satisfy `type IS NULL` for every buy-crypto
        // that has NO chargeback bank TX at all
        { ...healBase, chargebackBankTx: { id: Not(IsNull()), type: IsNull(), created: healWindow } },
        { ...healBase, chargebackBankTx: { id: Not(IsNull()), type: In(BankTxUnassignedTypes), created: healWindow } },
      ],
      relations: { chargebackBankTx: { transaction: true }, transaction: { user: { userData: true } } },
    });
    for (const entity of unhealed) {
      try {
        await this.bankTxService.updateInternal(
          entity.chargebackBankTx,
          { type: BankTxType.BUY_CRYPTO_RETURN },
          entity.transaction?.user,
        );
      } catch (e) {
        this.logger.error(`Failed to type external chargeback bank TX of buy-crypto ${entity.id}:`, e);
      }
    }
  }

  private async convertNetworkFee(from: Active, to: Active, fee: number): Promise<number> {
    if (isAsset(to) && [AssetType.CUSTOM, AssetType.PRESALE].includes(to.type)) return 0;

    const referenceOutputPrice = await this.pricingService.getPrice(from, to, PriceValidity.VALID_ONLY);

    return referenceOutputPrice.convert(fee);
  }
}
