import { Injectable, OnModuleInit } from '@nestjs/common';
import * as IbanTools from 'ibantools';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { VirtualIbanRepository } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.repository';
import { EntityManager } from 'typeorm';
import { FiatPaymentMethod } from '../../payment/dto/payment-method.enum';
import { Bank } from './bank.entity';
import { BankRepository } from './bank.repository';
import { FRICK_CURRENCIES, IbanBankName } from './dto/bank.dto';
import { ReceiveIbanStatus } from './dto/receive-iban.enum';

export interface BankSelectorInput {
  amount?: number;
  currency: string;
  paymentMethod: FiatPaymentMethod;
  userData?: UserData;
}

@Injectable()
export class BankService implements OnModuleInit {
  private readonly logger = new DfxLogger(BankService);
  private static ibanCache: Map<string, string> = new Map(); // key: "bankName-currency", value: iban
  private static unboundIbanCache: Map<string, Set<string>> = new Map(); // only IBANs with no asset-bound bank row

  // The VirtualIbanRepository is injected instead of the VirtualIbanService: that service depends on this
  // one, and both live in BankModule, so the service-level dependency would close a provider cycle.
  constructor(
    private readonly bankRepo: BankRepository,
    private readonly virtualIbanRepo: VirtualIbanRepository,
  ) {}

  onModuleInit() {
    void this.loadIbanCache();
  }

  async getAllBanks(): Promise<Bank[]> {
    return this.bankRepo.findCached(`all`, { relations: { asset: true } });
  }

  async getBanksWithAsset(): Promise<Bank[]> {
    return this.bankRepo.find({ relations: { asset: true } });
  }

  async getBanksByName(bankName: IbanBankName): Promise<Bank[]> {
    return this.bankRepo.findCachedBy(bankName, { name: bankName });
  }

  async getBankInternal(name: IbanBankName, currency: string, manager?: EntityManager): Promise<Bank> {
    // A (name, currency) pair can match more than one row (e.g. a retired legacy account alongside its
    // replacement, or a second account created for the same bank/currency without an asset link).
    // Rows are ordered newest-first; selectAttributionBank then prefers the asset-linked identity so
    // per-asset matching (isBankMatching) stays aligned with bank_tx history.
    const options = {
      where: { name, currency },
      order: { id: 'DESC' as const },
      relations: { asset: true },
    };
    const banks = manager
      ? await manager.find(Bank, options)
      : await this.bankRepo.findCached(`${name}-${currency}`, options);
    return BankService.selectAttributionBank(banks);
  }

  async getBankById(id: number): Promise<Bank> {
    return this.bankRepo.findOneCachedBy(`${id}`, { id });
  }

  async getBankByIdUncached(id: number): Promise<Bank> {
    return this.bankRepo.findOneBy({ id });
  }

  async getBankByIban(iban: string): Promise<Bank> {
    // accountIban is nullable and parsed from the SEPA payload; absent, the lookup returns an
    // arbitrary Bank, which then drives the chargeback fee.
    if (!iban) return undefined;

    return this.bankRepo.findOneCachedBy(`iban:${iban}`, { iban });
  }

  async areKnownBankIbans(...ibans: string[]): Promise<boolean> {
    if (!ibans.length || ibans.some((iban) => !iban)) return false;

    const banks = await this.getAllBanks();
    BankService.setIbanAttributionCache(banks);
    const knownIbans = new Set(banks.map((bank) => BankService.normalizeIban(bank.iban)));

    return ibans.every((iban) => knownIbans.has(BankService.normalizeIban(iban)));
  }

  async getReceiveBanks(): Promise<Bank[]> {
    return this.bankRepo.findCachedBy(`receive`, { receive: true });
  }

  async getSenderBanks(currency: string): Promise<Bank[]> {
    return this.bankRepo.findCachedBy(`send-${currency}`, { currency, send: true });
  }

  // --- BANK SELECTOR --- //
  // Returns undefined when no eligible receiving (receive=true) bank exists for either the requested
  // currency or the EUR fallback.
  async getBank({ currency, paymentMethod }: BankSelectorInput): Promise<Bank | undefined> {
    const fallBackCurrency = 'EUR';

    const receiveBanks = await this.getReceiveBanks();

    // Product decision, deliberately hardcoded: EUR and CHF bank transfers are routed to Bank Frick.
    // Resolved per currency through getBankInternal so this picks the row selectAttributionBank would
    // pick - (name, currency) is not unique, and the asset-linked identity is the one isBankMatching
    // and the booked bank_tx history are keyed on. Choosing by any other rule here, e.g. the newest
    // row, would hand out an IBAN that attribution does not follow.
    // This aligns the selection RULE, not the caches: ibanCache is loaded once at module init while
    // this read goes through the repository cache, so a bank row edited at runtime can still be seen
    // differently by the two until the process restarts. That gap predates this rule and applies to
    // every bank; do not read this call as a guarantee that the two can never disagree.
    // The rule is scoped to exactly EUR/CHF + BANK; receive must still hold, since getBankInternal
    // does not filter on it - and if the attributed row is not receiving, no other Frick row stands
    // in for it, because the exclusion below then applies to all of them.
    if (FRICK_CURRENCIES.includes(currency) && paymentMethod === FiatPaymentMethod.BANK) {
      const frick = await this.getBankInternal(IbanBankName.FRICK, currency);
      if (frick?.receive) return frick;
    }

    // Everything below keeps the categorical exclusion the removed bank-name filter provided: Bank
    // Frick must not win a currency it was never routed to, and must not be reachable through the
    // instant lookup or the EUR currency fallback either. Only the explicit rule above may return it.
    const banks = receiveBanks.filter((bank) => bank.name !== IbanBankName.FRICK);

    // select the matching bank account
    let account: Bank | undefined;

    // instant bank
    if (!account && paymentMethod === FiatPaymentMethod.INSTANT) {
      account = this.getMatchingBank(banks, currency, fallBackCurrency, (b) => b.sctInst);
    }

    // fallback => any active bank
    if (!account) {
      account = this.getMatchingBank(banks, currency, fallBackCurrency);
    }

    return account;
  }

  private getMatchingBank(
    banks: Bank[],
    currencyName: string,
    fallBackCurrencyName: string,
    selector?: (bank: Bank) => boolean,
  ): Bank | undefined {
    const matchingBanks = selector ? banks.filter(selector) : banks;

    return (
      matchingBanks.find((b) => b.currency === currencyName) ??
      matchingBanks.find((b) => b.currency === fallBackCurrencyName)
    );
  }

  static isBankMatching(asset: Asset, accountIban: string): boolean {
    const normalizedAccountIban = BankService.normalizeIban(accountIban);
    if (!normalizedAccountIban) return false;

    if (asset.bank?.iban) return BankService.normalizeIban(asset.bank.iban) === normalizedAccountIban;

    const bankName = this.blockchainToBankName(asset.blockchain);
    if (!bankName) return false;

    const expectedIban = this.ibanCache.get(`${bankName}-${asset.dexName}`);
    const normalizedExpectedIban = BankService.normalizeIban(expectedIban);
    return Boolean(normalizedExpectedIban && normalizedExpectedIban === normalizedAccountIban);
  }

  static isInternalBankMatching(asset: Asset, accountIban: string): boolean {
    const normalizedIban = BankService.normalizeIban(accountIban);
    if (!normalizedIban) return false;
    if (BankService.normalizeIban(asset.bank?.iban) === normalizedIban) return true;

    const bankName = this.blockchainToBankName(asset.blockchain);
    if (!bankName) return false;

    const key = `${bankName}-${asset.dexName}`;
    if (!BankService.unboundIbanCache.get(normalizedIban)?.has(key)) return false;

    const selectedIban = BankService.ibanCache.get(key);
    return (
      Boolean(asset.bank?.iban && selectedIban) &&
      BankService.normalizeIban(asset.bank.iban) === BankService.normalizeIban(selectedIban)
    );
  }

  // --- RECEIVE IBAN CHECK --- //

  // Tells the client whether an IBAN typed in by a customer is one that belongs to DFX - not whether it still
  // accepts money. Pure input aid for the support form: it enforces nothing, it only lets the frontend phrase
  // a helpful hint.
  async getReceiveIbanStatus(iban: string, userDataId?: number): Promise<ReceiveIbanStatus> {
    // normalizeIban strips separator characters and yields null for input that cannot hold an IBAN at all;
    // it does not rescue every conceivable input (a `IBAN:` prefix stays invalid, correctly). Both sides of
    // every comparison run through it, so a stored value in paper format matches too.
    const normalizedIban = BankService.normalizeIban(iban);
    if (!normalizedIban || !IbanTools.validateIBAN(normalizedIban).valid) return ReceiveIbanStatus.INVALID_IBAN;

    // Deliberately not filtered by `receive`: a hit on a retired or closed account is still money that went
    // to DFX, and a missing transfer can predate the account being stood down. A receive=true filter would
    // tell a real customer that their IBAN does not belong to DFX.
    const banks = await this.getAllBanks();
    if (banks.some((b) => BankService.normalizeIban(b.iban) === normalizedIban)) return ReceiveIbanStatus.DFX_IBAN;

    // Personal IBANs are only ever checked for the requesting account. The guard is optional, so a global
    // lookup would turn this endpoint into an unauthenticated oracle over customer-bound IBANs. Without a
    // login the personal IBANs stay unchecked, hence the answer must never be NOT_MATCHED here.
    if (!userDataId) return ReceiveIbanStatus.LOGIN_REQUIRED;

    // No lifecycle filter either (active=false, status Expired/Deactivated/Reserved all count): an expired
    // personal IBAN was still a real receiving IBAN. Same cache key and filter as
    // VirtualIbanService.getVirtualIbansForAccount, so both paths share the cached list.
    const virtualIbans = await this.virtualIbanRepo.findCachedBy(`user-${userDataId}`, {
      userData: { id: userDataId },
    });
    if (virtualIbans.some((v) => BankService.normalizeIban(v.iban) === normalizedIban))
      return ReceiveIbanStatus.DFX_IBAN;

    return ReceiveIbanStatus.NOT_MATCHED;
  }

  // --- HELPER METHODS --- //

  // An IBAN is ASCII alphanumeric only, so everything else is separator noise: grouping spaces of any kind,
  // hyphens, dots, slashes, quotes, and the invisible formatting characters that come along when a value
  // is pasted out of a statement PDF or an HTML mail. Removing everything that is not ASCII alphanumeric
  // covers every separator by construction, where chasing a deny-list did not - ibantools' own
  // electronicFormatIBAN only removes ASCII spaces and hyphens, and \s misses the zero-width family.
  // Note this also drops non-ASCII letters and digits, so a label in a non-Latin script is silently
  // stripped rather than making the value invalid. Harmless (it can never produce a *different* valid
  // IBAN), but it means only ASCII surroundings are reliably rejected.
  // The parameter is widened past the callers' types on purpose: this sits on the trust boundary between a
  // request body and the comparison, so it answers for anything the type system cannot actually guarantee.
  static normalizeIban(iban: string | null | undefined): string | null {
    if (typeof iban !== 'string') return null;

    return iban.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null;
  }

  // Picks the bank row that owns attribution for a single (name, currency) key. `banks` must already
  // be sorted by id descending (newest first). Prefer a row linked to an asset: that binding is the
  // basis of every per-asset match (isBankMatching) and of the IBAN already present on booked
  // bank_tx. If a newer unbound row won instead, asset-side amounts would drop to 0 while the
  // exchange side still counted — permanent netting skew in the financial log. When no row is
  // asset-linked, fall back to the newest row so stale legacy rows still cannot silently win.
  private static selectAttributionBank(banks: Bank[]): Bank | undefined {
    if (!banks.length) return undefined;
    return banks.find((b) => b.asset != null) ?? banks[0];
  }

  private async loadIbanCache(): Promise<void> {
    // Newest-first so that within each (name, currency) group the order handed to
    // selectAttributionBank is deterministic; asset-linked rows still beat newer unbound ones.
    const banks = await this.bankRepo.find({ order: { id: 'DESC' }, relations: { asset: true } });
    BankService.setIbanAttributionCache(banks);

    const byKey = Util.groupByAccessor(banks, (b) => `${b.name}-${b.currency}`);

    for (const [key, group] of byKey) {
      const selected = BankService.selectAttributionBank(group);
      if (!selected) continue;

      const distinctIbans = new Set(group.map((b) => b.iban));
      if (group.length > 1 && distinctIbans.size > 1) {
        this.logger.warn(
          `Multiple bank rows for key ${key} with different IBANs (count=${group.length}, ids=[${group
            .map((b) => b.id)
            .join(', ')}], selectedId=${selected.id})`,
        );
      }

      BankService.ibanCache.set(key, selected.iban);
    }
  }

  private static setIbanAttributionCache(banks: Bank[]): void {
    BankService.unboundIbanCache.clear();

    const banksByIban = Util.groupByAccessor(banks, (bank) => BankService.normalizeIban(bank.iban));

    for (const [normalizedIban, ibanBanks] of banksByIban) {
      if (!normalizedIban) continue;

      const keys = new Set(ibanBanks.map((bank) => `${bank.name}-${bank.currency}`));

      // A loaded asset relation makes the IBAN attributable only to that exact asset.bank IBAN.
      // The name/currency fallback is reserved for bank rows that are genuinely unbound, otherwise
      // two asset-bound accounts of the same bank/currency would both count the same transfer.
      if (ibanBanks.every((bank) => bank.asset === null || bank.asset === undefined))
        BankService.unboundIbanCache.set(normalizedIban, keys);
    }
  }

  private static blockchainToBankName(blockchain: Blockchain): IbanBankName | undefined {
    switch (blockchain) {
      case Blockchain.MAERKI_BAUMANN:
        return IbanBankName.MAERKI;
      case Blockchain.OLKYPAY:
        return IbanBankName.OLKY;
      case Blockchain.YAPEAL:
        return IbanBankName.YAPEAL;
      case Blockchain.FRICK:
        return IbanBankName.FRICK;
      default:
        return undefined;
    }
  }
}
