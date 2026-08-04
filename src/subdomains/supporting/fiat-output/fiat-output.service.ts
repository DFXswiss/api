import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Country } from 'src/shared/models/country/country.entity';
import { AmountType, Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { SellRepository } from 'src/subdomains/core/sell-crypto/route/sell.repository';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { EntityManager, IsNull, Not } from 'typeorm';
import { BankTxRepeatService } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturn } from '../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTxReturnService } from '../bank-tx/bank-tx-return/bank-tx-return.service';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from '../bank/bank/bank.service';
import { PayInStatus } from '../payin/entities/crypto-input.entity';
import { CreateFiatOutputDto } from './dto/create-fiat-output.dto';
import { UpdateFiatOutputDto } from './dto/update-fiat-output.dto';
import { FiatOutput, FiatOutputType } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputService {
  constructor(
    private readonly fiatOutputRepo: FiatOutputRepository,
    private readonly buyFiatRepo: BuyFiatRepository,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly buyCryptoRepo: BuyCryptoRepository,
    @Inject(forwardRef(() => BankTxReturnService))
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly bankTxRepeatService: BankTxRepeatService,
    private readonly bankService: BankService,
    private readonly sellRepo: SellRepository,
    private readonly virtualIbanService: VirtualIbanService,
  ) {}

  /**
   * Automatic selection is restricted to incumbent banks. Bank Frick is payout-eligible only through
   * an explicit per-output assignment at creation or in the database, never through automatic selection.
   * All send-enabled personal-IBAN candidates are considered so an excluded candidate cannot hide an
   * eligible one.
   */
  async selectPayoutBank(
    currency: string,
    type: FiatOutputType,
    userData: UserData | undefined,
    country: Country,
  ): Promise<{ accountIban: string | undefined; bank: Bank | undefined }> {
    // use virtual IBAN if existing
    if (userData && [FiatOutputType.BUY_FIAT, FiatOutputType.BUY_CRYPTO_FAIL].includes(type)) {
      const candidates = await this.virtualIbanService.getActiveSendingCandidatesForUserAndCurrency(userData, currency);
      const virtualIban = candidates.find(
        (candidate) => candidate.bank.name !== IbanBankName.FRICK && candidate.bank.isCountryEnabled(country),
      );
      if (virtualIban) return { accountIban: virtualIban.iban, bank: virtualIban.bank };
    }

    // Automatic payout selection excludes Bank Frick by name; it is payout-eligible exclusively through
    // explicit per-output assignment (accountIban at creation or manual database assignment). This is
    // independent of the customer-facing deposit direction: BankService.getBank() deliberately routes
    // EUR deposits to Bank Frick. The payout exclusion and deposit routing therefore do not conflict.
    const banks = (await this.bankService.getSenderBanks(currency)).filter(
      (candidate) => candidate.name !== IbanBankName.FRICK,
    );
    const eligibleBanks = banks.filter((candidate) => candidate.isCountryEnabled(country));

    // Sender priority (lower wins) is the deterministic tie-breaker between multiple eligible senders for
    // the same currency - an operational input (Bank.sendPriority), not a hardcoded bank-name preference.
    // Array.prototype.sort is stable, so candidates with the same priority keep their pre-existing order.
    const sortedBanks = [...eligibleBanks].sort((a, b) => a.sendPriority - b.sendPriority);
    const bank = sortedBanks[0];
    return bank ? { accountIban: bank.iban, bank } : { accountIban: undefined, bank: undefined };
  }

  async create(dto: CreateFiatOutputDto): Promise<FiatOutput> {
    this.validateRequiredCreditorFields(dto);

    if (dto.buyCryptoId || dto.buyFiatId || dto.bankTxReturnId || dto.bankTxRepeatId) {
      const existing = await this.fiatOutputRepo.exists({
        where: dto.buyCryptoId
          ? { buyCrypto: { id: dto.buyCryptoId }, type: dto.type }
          : dto.buyFiatId
            ? { buyFiats: { id: dto.buyFiatId }, type: dto.type }
            : dto.bankTxReturnId
              ? { bankTxReturn: { id: dto.bankTxReturnId }, type: dto.type }
              : { bankTxRepeat: { id: dto.bankTxRepeatId }, type: dto.type },
      });
      if (existing) throw new BadRequestException('FiatOutput already exists');
    }

    const entity = this.fiatOutputRepo.create({ ...dto, isInstant: dto.isInstant ?? false });
    if (entity.amount != null) entity.amount = Util.roundReadable(entity.amount, AmountType.FIAT);

    if (dto.buyFiatId) {
      entity.buyFiats = [await this.buyFiatRepo.findOneBy({ id: dto.buyFiatId })];
      if (!entity.buyFiats[0]) throw new NotFoundException('BuyFiat not found');
      if (
        dto.type === 'BuyFiat' &&
        [PayInStatus.FORWARD_CONFIRMED, PayInStatus.COMPLETED].includes(entity.buyFiats[0].cryptoInput.status)
      )
        throw new BadRequestException('CryptoInput not confirmed');
    }

    if (dto.buyCryptoId) {
      entity.buyCrypto = await this.buyCryptoRepo.findOneBy({ id: dto.buyCryptoId });
      if (!entity.buyCrypto) throw new NotFoundException('BuyCrypto not found');
    }

    if (dto.bankTxReturnId) {
      entity.bankTxReturn = await this.bankTxReturnService.getBankTxReturn(dto.bankTxReturnId);
      if (!entity.bankTxReturn) throw new NotFoundException('BankTxReturn not found');
    }

    if (dto.bankTxRepeatId) {
      entity.bankTxRepeat = await this.bankTxRepeatService.getBankTxRepeat(dto.bankTxRepeatId);
      if (!entity.bankTxRepeat) throw new NotFoundException('BankTxRepeat not found');
    }

    if (entity.accountIban && !entity.bank) {
      const bank = await this.bankService.getBankByIban(entity.accountIban);
      if (!bank) throw new BadRequestException('No bank found for account IBAN');
      entity.bank = bank;
    }

    if (
      entity.isInstant &&
      (entity.currency !== 'EUR' || entity.bank?.name !== IbanBankName.FRICK || entity.bank?.currency !== 'EUR')
    ) {
      throw new BadRequestException('Instant requires an explicitly assigned Bank Frick EUR output');
    }

    return this.fiatOutputRepo.save(entity);
  }

  async createInternal(
    type: FiatOutputType,
    { buyCrypto, buyFiats, bankTxReturn }: { buyCrypto?: BuyCrypto; buyFiats?: BuyFiat[]; bankTxReturn?: BankTxReturn },
    originEntityId: number,
    createReport = false,
    inputCreditorData?: Partial<FiatOutput>,
    manager?: EntityManager,
  ): Promise<FiatOutput> {
    // second line of defense against a double refund: once a chargeback bank TX is linked (refund
    // executed externally and matched, or linked manually), no further refund output may be created
    if (type === FiatOutputType.BUY_CRYPTO_FAIL && buyCrypto) {
      const repo = manager?.getRepository(BuyCrypto) ?? this.buyCryptoRepo;
      const alreadyRefunded = await repo.existsBy({ id: buyCrypto.id, chargebackBankTx: { id: Not(IsNull()) } });
      if (alreadyRefunded)
        throw new ConflictException('Chargeback already executed for this buy-crypto (chargeback bank TX linked)');
    }

    let creditorData: Partial<FiatOutput> = inputCreditorData ?? {};

    // For BuyFiat without inputCreditorData: auto-populate from seller's UserData
    if (type === FiatOutputType.BUY_FIAT && buyFiats?.length > 0 && !inputCreditorData) {
      const userData = buyFiats[0].userData;
      if (userData) {
        // Determine IBAN: from payoutRoute (PaymentLink) or sell route
        let iban = buyFiats[0].sell?.iban;

        const payoutRouteId = buyFiats[0].paymentLinkPayment?.link?.linkConfigObj?.payoutRouteId;
        if (payoutRouteId) {
          const payoutRoute = await this.sellRepo.findOneBy({ id: payoutRouteId });
          if (payoutRoute) {
            iban = payoutRoute.iban;
          }
        }

        creditorData = {
          currency: buyFiats[0].outputAsset?.name,
          amount: buyFiats.reduce((sum, bf) => sum + (bf.outputAmount ?? 0), 0),
          name: userData.completeName,
          address: userData.address.street,
          houseNumber: userData.address.houseNumber,
          zip: userData.address.zip,
          city: userData.address.city,
          country: userData.address.country?.symbol,
          iban,
        };
      }
    }

    const repo = manager?.getRepository(FiatOutput) ?? this.fiatOutputRepo;
    const entity = repo.create({
      type,
      buyCrypto,
      buyFiats,
      bankTxReturn,
      originEntityId,
      ...creditorData,
      amount: Util.roundReadable(creditorData.amount, AmountType.FIAT),
    });

    // Validate creditor fields for all types - data comes from frontend or admin DTO
    try {
      this.validateRequiredCreditorFields(entity);
    } catch (e) {
      throw new Error(`Failed to create fiat output for ${type} ${originEntityId}: ${e.message}`);
    }

    if (createReport) entity.reportCreated = false;

    return repo.save(entity);
  }

  private validateRequiredCreditorFields(data: Partial<FiatOutput>): void {
    const requiredFields = ['currency', 'amount', 'name', 'address', 'zip', 'city', 'country', 'iban'] as const;
    const missingFields = requiredFields.filter(
      (field) => data[field] == null || (typeof data[field] === 'string' && data[field].trim() === ''),
    );

    if (missingFields.length > 0) {
      throw new Error(`Missing required creditor fields: ${missingFields.join(', ')}`);
    }
  }

  async update(id: number, dto: UpdateFiatOutputDto): Promise<FiatOutput> {
    const entity = await this.fiatOutputRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('FiatOutput not found');

    if (dto.bankTxId) {
      entity.bankTx = await this.bankTxService.getBankTxRepo().findOneBy({ id: dto.bankTxId });
      if (!entity.bankTx) throw new NotFoundException('BankTx not found');
    }

    if (dto.accountIban) {
      entity.bank = await this.bankService.getBankByIban(dto.accountIban);
      if (!entity.bank) throw new BadRequestException('No bank found for account IBAN');
    }

    if (dto.amount != null) dto.amount = Util.roundReadable(dto.amount, AmountType.FIAT);

    return this.fiatOutputRepo.save({ ...entity, ...dto, bank: entity.bank });
  }

  async delete(id: number): Promise<void> {
    const entity = await this.fiatOutputRepo.findOne({ where: { id }, relations: { buyFiats: true } });
    if (!entity) throw new NotFoundException('FiatOutput not found');
    if (entity.buyFiats?.length) throw new BadRequestException('FiatOutput remaining buyFiat');

    await this.fiatOutputRepo.delete(id);
  }

  async getFiatOutputByKey(key: string, value: any): Promise<FiatOutput> {
    return this.fiatOutputRepo
      .createQueryBuilder('fiatOutput')
      .select('fiatOutput')
      .leftJoinAndSelect('fiatOutput.buyFiats', 'buyFiats')
      .leftJoinAndSelect('buyFiats.sell', 'sell')
      .leftJoinAndSelect('sell.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.verifiedCountry', 'verifiedCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `fiatOutput.${key}`} = :param`, { param: value })
      .getOne();
  }
}
