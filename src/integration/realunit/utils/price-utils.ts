import { Util } from 'src/shared/utils/util';

export class PriceUtils {
  static fillMissingDates<T extends { created: Date }>(prices: T[]): T[] {
    if (prices.length === 0) return prices;

    const sortedPrices = [...prices].sort((a, b) => a.created.getTime() - b.created.getTime());
    const filledPrices: T[] = [sortedPrices[0]];

    for (let i = 1; i < sortedPrices.length; i++) {
      const previousPrice = sortedPrices[i - 1];
      const currentPrice = sortedPrices[i];

      const daysBetween = Util.daysDiff(previousPrice.created, currentPrice.created);

      for (let dayOffset = 1; dayOffset < daysBetween; dayOffset++) {
        const filledDate = this.addDays(previousPrice.created, dayOffset);
        filledPrices.push({
          ...previousPrice,
          created: filledDate,
        });
      }

      filledPrices.push(currentPrice);
    }

    return filledPrices;
  }

  static stripTime(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}
