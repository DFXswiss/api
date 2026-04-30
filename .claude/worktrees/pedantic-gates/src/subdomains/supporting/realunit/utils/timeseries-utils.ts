import { Util } from 'src/shared/utils/util';

export class TimeseriesUtils {
  static fillMissingDates<T extends { created: Date }>(items: T[]): T[] {
    if (items.length === 0) return items;

    const itemMap = new Map<string, T>();
    items.forEach((item) => {
      itemMap.set(Util.isoDate(TimeseriesUtils.stripTime(item.created)), item);
    });

    const oldestItem = items.reduce((oldest, curr) => (curr.created < oldest.created ? curr : oldest));
    const startDate = oldestItem.created;
    const endDate = TimeseriesUtils.stripTime(new Date());
    const filledItems: T[] = [];

    let lastKnownItem = oldestItem;
    for (let dayOffset = 0; dayOffset <= Util.daysDiff(startDate, endDate); dayOffset++) {
      const currentDate = TimeseriesUtils.stripTime(Util.daysAfter(dayOffset, startDate));
      lastKnownItem = itemMap.get(Util.isoDate(currentDate)) ?? lastKnownItem;
      filledItems.push({ ...lastKnownItem, created: currentDate });
    }

    return filledItems;
  }

  static stripTime(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
}
