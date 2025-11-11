export class PriceUtils {
  static fillMissingDates<T extends { created: Date }>(prices: T[]): T[] {
    if (prices.length === 0) return prices;

    const sortedPrices = [...prices].sort((a, b) => a.created.getTime() - b.created.getTime());
    const filledPrices: T[] = [sortedPrices[0]];

    for (let i = 1; i < sortedPrices.length; i++) {
      const previousPrice = sortedPrices[i - 1];
      const currentPrice = sortedPrices[i];

      const daysBetween = this.getDaysDifference(previousPrice.created, currentPrice.created);

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

  private static getDaysDifference(startDate: Date, endDate: Date): number {
    const start = this.stripTime(startDate);
    const end = this.stripTime(endDate);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }

  static stripTime(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  static toTimestampMap<T extends { created: Date }>(prices: T[]): Map<number, T> {
    const map = new Map<number, T>();

    PriceUtils.fillMissingDates(prices).forEach((price) => {
      map.set(PriceUtils.stripTime(price.created).getTime(), price);
    });

    return map;
  }
}
