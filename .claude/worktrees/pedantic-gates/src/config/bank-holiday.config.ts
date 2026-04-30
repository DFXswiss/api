import { InfoBannerDto } from 'src/shared/models/setting/dto/info-banner.dto';
import { Util } from 'src/shared/utils/util';

export const BankHolidays = [
  '2025-01-01',
  '2025-04-18',
  '2025-04-21',
  '2025-05-29',
  '2025-06-09',
  '2025-08-01',
  '2025-12-25',
  '2025-12-26',
  '2026-01-01',
  '2026-04-03',
  '2026-04-06',
  '2026-05-14',
  '2026-05-25',
  '2026-08-01',
  '2026-12-25',
  '2026-12-26',
];

export const LiechtensteinBankHolidays = [
  '2026-01-01',
  '2026-01-02',
  '2026-01-06',
  '2026-04-06',
  '2026-05-01',
  '2026-05-14',
  '2026-05-25',
  '2026-06-04',
  '2026-08-15',
  '2026-09-08',
  '2026-11-01',
  '2026-12-08',
  '2026-12-24',
  '2026-12-25',
  '2026-12-26',
  '2026-12-31',
];

function isHoliday(date: Date, holidays: string[]): boolean {
  const isWeekend = [0, 6].includes(date.getDay());
  return holidays.includes(Util.isoDate(date)) || isWeekend;
}

export function isBankHoliday(date = new Date()): boolean {
  return isHoliday(date, BankHolidays);
}

export function isLiechtensteinBankHoliday(date = new Date()): boolean {
  return isHoliday(date, LiechtensteinBankHolidays);
}

export function getBankHolidayInfoBanner(): InfoBannerDto {
  return {
    id: `bank-holiday-${new Date().toDateString()}`,
    de: 'Unsere Bank ist heute geschlossen. Bank-Transaktionen werden am nächsten Werktag bearbeitet.',
    en: 'Our bank is closed today. Bank transactions will be processed on the next business day.',
    fr: "Notre banque est fermée aujourd'hui. Les transactions bancaires seront traitées le jour ouvrable suivant.",
    it: 'La nostra banca è chiusa oggi. Le transazioni bancarie saranno elaborate il prossimo giorno lavorativo.',
  };
}
