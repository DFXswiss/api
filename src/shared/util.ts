export class Util {
  static replaceInKeys(obj: any, searchValue: string, replaceValue: string): any {
    return this.updateKeys(obj, (key) => key.replace(searchValue, replaceValue));
  }

  static updateKeys(obj: any, update: (key: string) => string): any {
    return Object.keys(obj).reduce((prev, curr) => ({ ...prev, [update(curr)]: obj[curr] }), {});
  }

  static round(amount: number, decimals: number): number {
    return Math.round(amount * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }
}
