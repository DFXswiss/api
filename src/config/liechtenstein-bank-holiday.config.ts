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
