import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
import { FiatOutputFrickService } from 'src/subdomains/supporting/fiat-output/fiat-output-frick.service';
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
    private readonly frickPayoutService: FiatOutputFrickService,
  ) {}

  async selectPayoutBank(
    currency: string,
    type: FiatOutputType,
    userData: UserData | undefined,
    isInstant: boolean,
    country: Country,
  ): Promise<{ accountIban: string | undefined; bank: Bank | undefined }> {
    // A Frick instant payout is only ever supported for EUR (Bank Frick rejects instant CHF/FOREIGN
    // orders outright) - gate on both the capability flag and the currency so an instant CHF output can
    // never be assigned to Frick in the first place, rather than failing on every transmit retry.
    const isEligibleFrickCandidate = (bank: Bank): boolean =>
      bank.name !== IbanBankName.FRICK || !isInstant || (bank.sctInst && currency === 'EUR');

    // use virtual IBAN if existing
    if (userData && [FiatOutputType.BUY_FIAT, FiatOutputType.BUY_CRYPTO_FAIL].includes(type)) {
      const virtualIban = await this.virtualIbanService.getActiveForUserAndCurrency(userData, currency);

      if (
        virtualIban?.bank?.send &&
        isEligibleFrickCandidate(virtualIban.bank) &&
        virtualIban.bank.isCountryEnabled(country) &&
        (virtualIban.bank.name !== IbanBankName.FRICK || this.frickPayoutService.canCreatePayments())
      )
        return { accountIban: virtualIban.iban, bank: virtualIban.bank };
    }

    // fallback to standard bank account selection
    const banks = await this.bankService.getSenderBanks(currency);
    const eligibleBanks = banks.filter(
      (candidate) =>
        isEligibleFrickCandidate(candidate) &&
        candidate.isCountryEnabled(country) &&
        (candidate.name !== IbanBankName.FRICK || this.frickPayoutService.canCreatePayments()),
    );

    // Sender priority (lower wins) is the deterministic tie-breaker between multiple eligible senders for
    // the same currency - an operational input (Bank.sendPriority), not a hardcoded bank-name preference.
    // A throw is reserved for a genuine priority tie that involves Frick itself, never for a tie between
    // two non-Frick incumbents (e.g. Olkypay EUR and Yapeal EUR both send=true at the shared default
    // priority): Array.prototype.sort is stable, so when every candidate shares the same priority, the
    // pre-existing first-match order is used instead of throwing away an otherwise-workable route.
    const sortedBanks = [...eligibleBanks].sort((a, b) => a.sendPriority - b.sendPriority);
    const tiedForTop = sortedBanks.filter((candidate) => candidate.sendPriority === sortedBanks[0]?.sendPriority);
    if (tiedForTop.length > 1 && tiedForTop.some((candidate) => candidate.name === IbanBankName.FRICK))
      throw new Error(`Ambiguous sender bank priority for ${currency}`);

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

    const entity = this.fiatOutputRepo.create(dto);
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
      if (bank) entity.bank = bank;
    }

    return this.fiatOutputRepo.save(entity);
  }

  async createInternal(
    type: FiatOutputType,
    { buyCrypto, buyFiats, bankTxReturn }: { buyCrypto?: BuyCrypto; buyFiats?: BuyFiat[]; bankTxReturn?: BankTxReturn },
    originEntityId: number,
    createReport = false,
    inputCreditorData?: Partial<FiatOutput>,
  ): Promise<FiatOutput> {
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

    const entity = this.fiatOutputRepo.create({
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

    return this.fiatOutputRepo.save(entity);
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

    if (dto.amount != null) dto.amount = Util.roundReadable(dto.amount, AmountType.FIAT);

    return this.fiatOutputRepo.save({ ...entity, ...dto });
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
