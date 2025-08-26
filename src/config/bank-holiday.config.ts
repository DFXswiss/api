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
];

export function isBankHoliday(date?: Date): boolean {
  return BankHolidays.includes(Util.isoDate(date ?? new Date()));
}
