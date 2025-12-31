import { InfoBannerDto } from 'src/shared/models/setting/dto/info-banner.dto';
import { Util } from 'src/shared/utils/util';

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

export function isLiechtensteinBankHoliday(date = new Date()): boolean {
  const isWeekend = [0, 6].includes(date.getDay());
  return LiechtensteinBankHolidays.includes(Util.isoDate(date)) || isWeekend;
}

export function getLiechtensteinBankHolidayInfoBanner(): InfoBannerDto {
  return {
    id: `liechtenstein-bank-holiday-${new Date().toDateString()}`,
    de: 'Unsere Bank in Liechtenstein ist heute geschlossen. Bank-Transaktionen werden am nächsten Werktag bearbeitet.',
    en: 'Our bank in Liechtenstein is closed today. Bank transactions will be processed on the next business day.',
    fr: "Notre banque au Liechtenstein est fermée aujourd'hui. Les transactions bancaires seront traitées le jour ouvrable suivant.",
    it: 'La nostra banca in Liechtenstein è chiusa oggi. Le transazioni bancarie saranno elaborate il prossimo giorno lavorativo.',
  };
}
