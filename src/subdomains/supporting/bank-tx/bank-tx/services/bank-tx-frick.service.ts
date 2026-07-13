import { ConflictException, Injectable } from '@nestjs/common';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Bank } from '../../../bank/bank/bank.entity';
import { BankService } from '../../../bank/bank/bank.service';
import { IbanBankName } from '../../../bank/bank/dto/bank.dto';
import { SpecialExternalAccount } from '../../../payment/entities/special-external-account.entity';
import { SpecialExternalAccountService } from '../../../payment/services/special-external-account.service';
import { BankTx } from '../entities/bank-tx.entity';

@Injectable()
export class BankTxFrickService {
  private readonly logger = new DfxLogger(BankTxFrickService);

  private frickUnavailableWarningLogged = false;

  // Bank Frick statement fetches overlap the watermark by this many days so delayed bank-side reporting and
  // multi-instance polling races cannot silently advance past entries that only become visible later.
  private static readonly FRICK_WATERMARK_OVERLAP_DAYS = 2;

  constructor(
    private readonly frickService: BankFrickService,
    private readonly bankService: BankService,
    private readonly settingService: SettingService,
    private readonly specialAccountService: SpecialExternalAccountService,
  ) {}

  async checkTransactions(
    createTx: (bankTx: Partial<BankTx>, multiAccounts: SpecialExternalAccount[]) => Promise<Partial<BankTx>>,
  ): Promise<void> {
    if (!this.frickService.isAvailable()) {
      this.warnFrickUnavailableOnce('Bank Frick service not configured - skipping transaction import');
      return;
    }

    let banks: Bank[];
    try {
      banks = await this.bankService
        .getBanksByName(IbanBankName.FRICK)
        .then((rows) => rows.filter((bank) => bank.receive));
    } catch (error) {
      this.logger.error('Failed to load Bank Frick account registry:', error);
      return;
    }
    if (!banks.length) {
      this.warnFrickUnavailableOnce('No receiving Bank Frick accounts configured - skipping transaction import');
      return;
    }

    let multiAccounts: SpecialExternalAccount[];
    try {
      multiAccounts = await this.specialAccountService.getMultiAccounts();
    } catch (error) {
      this.logger.error('Failed to load special accounts for Bank Frick transaction import:', error);
      return;
    }

    for (const bank of banks) {
      if (!Number.isSafeInteger(bank.id) || bank.id <= 0) {
        this.logger.error('Failed to import Bank Frick transactions: invalid bank row id');
        continue;
      }

      const settingKey = `lastBankFrickDate:${bank.id}`;
      const lastModificationTime = new Date(await this.settingService.get(settingKey, new Date(0).toISOString()));
      const now = new Date();

      try {
        const transactions = await this.frickService.getFrickTransactions(lastModificationTime, bank.iban);
        const bookingTimes = transactions.map((transaction) => transaction.bookingDate?.getTime());
        if (bookingTimes.some((bookingTime) => !Number.isFinite(bookingTime)))
          throw new Error('Invalid booking date in parsed Bank Frick transaction');
        let fullyProcessed = true;

        for (const transaction of transactions) {
          try {
            await createTx(transaction, multiAccounts);
          } catch (error) {
            if (!(error instanceof ConflictException)) {
              fullyProcessed = false;
              this.logger.error(`Failed to import Bank Frick transaction for bank row ${bank.id}:`, error);
            }
          }
        }

        // The issue contract deliberately advances only after a non-empty response was fully persisted. Base the
        // candidate on the newest processed booking date (clamped to wall-clock now) and retain a fixed overlap.
        // SettingService performs an atomic monotonic update, preventing a stale concurrent worker from moving the
        // cursor backwards. Empty/malformed/partially persisted responses never advance it.
        if (fullyProcessed && transactions.length > 0) {
          const candidate = new Date(Math.min(now.getTime(), Math.max(...bookingTimes)));
          candidate.setUTCDate(candidate.getUTCDate() - BankTxFrickService.FRICK_WATERMARK_OVERLAP_DAYS);
          await this.settingService.setDateMax(settingKey, candidate);
        }
      } catch (error) {
        this.logger.error(`Failed to fetch Bank Frick transactions for bank row ${bank.id}:`, error);
      }
    }
  }

  private warnFrickUnavailableOnce(message: string): void {
    if (this.frickUnavailableWarningLogged) return;
    this.logger.warn(message);
    this.frickUnavailableWarningLogged = true;
  }
}
