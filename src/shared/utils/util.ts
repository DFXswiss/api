import { BinaryLike, createHash, createSign, KeyLike } from 'crypto';
import { XMLValidator, XMLParser } from 'fast-xml-parser';
import { readFile } from 'fs';
import { MinDeposit } from 'src/mix/models/deposit/dto/min-deposit.dto';

type KeyType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

type CryptoAlgorithm = 'md5' | 'sha256' | 'sha512';

export class Util {
  // --- MATH --- //
  static round(amount: number, decimals: number): number {
    return Math.round(amount * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  static sum(list: number[]): number {
    return list.reduce((prev, curr) => prev + curr, 0);
  }

  static sumObj<T>(list: T[], key: KeyType<T, number>): number {
    return this.sum(list.map((i) => i[key] as unknown as number));
  }

  static minObj<T>(list: T[], key: KeyType<T, number>): number {
    return Math.min(...list.map((i) => i[key] as unknown as number));
  }

  static avg(list: number[]): number {
    return this.sum(list) / list.length;
  }

  static aggregate<T>(list: T[], key: KeyType<T, string>, value: KeyType<T, number>): { [field: string]: number } {
    return list.reduce((prev, curr) => {
      const keyValue = curr[key] as unknown as string;
      if (prev[keyValue]) {
        prev[keyValue] += curr[value] as unknown as number;
      } else {
        prev[keyValue] = curr[value] as unknown as number;
      }
      return prev;
    }, {} as { [key: string]: number });
  }

  static groupBy<T>(list: T[], key: KeyType<T, string>): Map<string, T[]> {
    return list.reduce(
      (map, item) =>
        map.set(item[key] as unknown as string, (map.get(item[key] as unknown as string) ?? []).concat(item)),
      new Map<string, T[]>(),
    );
  }

  static randomId(): number {
    return Math.round(Math.random() * 1000000000);
  }

  // --- DATES --- //
  static secondsDiff(from?: Date, to?: Date): number {
    return ((to?.getTime() ?? 0) - (from?.getTime() ?? 0)) / 1000;
  }

  static minutesDiff(from?: Date, to?: Date): number {
    return this.secondsDiff(from, to) / 60;
  }

  static daysDiff(from?: Date, to?: Date): number {
    return this.secondsDiff(from, to) / (3600 * 24);
  }

  static daysAfter(days: number, from?: Date): Date {
    const date = from ? new Date(from) : new Date();
    date.setDate(date.getDate() + days);
    return date;
  }

  static daysBefore(days: number, from?: Date): Date {
    return this.daysAfter(-days, from);
  }

  static isoDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  // --- MISC --- //
  static async readFileFromDisk(fileName: string): Promise<string> {
    return new Promise((resolve, reject) =>
      readFile(fileName, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data.toString());
        }
      }),
    );
  }

  static async poll<T>(
    action: () => Promise<T | undefined>,
    verify: (result: T | undefined) => boolean,
    interval: number,
    timeout: number,
    catchErrors?: boolean,
  ): Promise<T | undefined> {
    return new Promise(async (resolve, reject) => {
      let abort = false;

      // action/error handling
      const doAction = async () =>
        await action().catch((e) => {
          if (catchErrors) return undefined;

          abort = true;
          reject(e);
        });

      // set timer
      const timer = setTimeout(() => (abort = true), timeout);

      // poll
      let result = await doAction();
      while (!abort && !verify(result)) {
        await this.delay(interval);
        result = await doAction();
      }

      clearTimeout(timer);
      return resolve(result);
    });
  }

  static async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static removeNullFields(entity: any): void {
    Object.keys(entity).forEach((k) => !entity[k] && delete entity[k]);
  }

  static createHash(data: BinaryLike, algo: CryptoAlgorithm = 'sha256'): string {
    const hash = createHash(algo);
    hash.update(data);
    return hash.digest('hex');
  }

  static createSign(data: BinaryLike, key: KeyLike, algo: CryptoAlgorithm): string {
    const sign = createSign(algo);
    sign.update(data);
    return sign.sign(key, 'base64');
  }

  static async retry<T>(action: () => Promise<T>, tryCount = 3, delay = 0): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (tryCount > 1) {
        await this.delay(delay);
        return this.retry(action, tryCount - 1, delay);
      }

      throw e;
    }
  }

  static parseXml<T>(file: string): T {
    const validationResult = XMLValidator.validate(file);
    if (validationResult !== true) {
      throw validationResult;
    }

    return new XMLParser({ ignoreAttributes: false }).parse(file);
  }

  static trimBlockchainAddress(address: string): string {
    return '***' + address.slice(address.length - 6);
  }

  static trimIBAN(iban: string): string {
    return '***' + iban.slice(iban.length - 4);
  }

  static transformToMinDeposit(deposit: { [asset: string]: number }, filter?: string[] | string): MinDeposit[] {
    return Object.entries(deposit)
      .filter(([key, _]) => filter?.includes(key) ?? true)
      .map(([key, value]) => ({ amount: value, asset: key }));
  }
}
