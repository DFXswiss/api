import BigNumber from 'bignumber.js';
import { TransformFnParams } from 'class-transformer';
import * as crypto from 'crypto';
import { BinaryLike, createHash, createSign, KeyLike } from 'crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { readFile } from 'fs';

export type KeyType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

type CryptoAlgorithm = 'md5' | 'sha256' | 'sha512';

export class Util {
  // --- MATH --- //
  static round(amount: number, decimals: number): number {
    return this.roundToValue(amount, Math.pow(10, -decimals));
  }

  static roundToValue(amount: number, value: number): number {
    return new BigNumber(Math.round(amount / value)).multipliedBy(value).toNumber();
  }

  static roundByPrecision(amount: number, precision: number): number {
    return new BigNumber(amount).precision(precision).toNumber();
  }

  static sum(list: number[]): number {
    return list.reduce((prev, curr) => prev + curr, 0);
  }

  static sumObjValue<T>(list: T[], key: KeyType<T, number>): number {
    return this.sum(list.map((i) => i[key] as unknown as number));
  }

  static minObjValue<T>(list: T[], key: KeyType<T, number>): number {
    return Math.min(...list.map((i) => i[key] as unknown as number));
  }

  static minObj<T>(list: T[], key: KeyType<T, number>): T {
    return list.reduce((i, j) => (i && j[key] >= i[key] ? i : j), undefined);
  }

  static maxObj<T>(list: T[], key: KeyType<T, number>): T {
    return list.reduce((i, j) => (i && j[key] <= i[key] ? i : j), undefined);
  }

  static avg(list: number[]): number {
    return this.sum(list) / list.length;
  }

  static toMap<T>(list: T[], key: KeyType<T, string>): Map<string, T> {
    const map = new Map<string, T>();
    list.forEach((item) => map.set(item[key] as unknown as string, item));
    return map;
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

  static groupBy<T, U>(list: T[], key: KeyType<T, U>): Map<U, T[]> {
    return list.reduce(
      (map, item) => map.set(item[key] as unknown as U, (map.get(item[key] as unknown as U) ?? []).concat(item)),
      new Map<U, T[]>(),
    );
  }

  static groupByAccessor<T, U>(list: T[], accessor: (item: T) => U): Map<U, T[]> {
    return list.reduce(
      (map, item) => map.set(accessor(item), (map.get(accessor(item)) ?? []).concat(item)),
      new Map<U, T[]>(),
    );
  }

  static fixRoundingMismatch<T>(list: T[], key: KeyType<T, number>, targetAmount: number, precision = 8): T[] {
    const listTotal = Util.round(Util.sumObjValue<T>(list, key), precision);
    const mismatch = Util.round(targetAmount - listTotal, precision);
    const maxMismatchThreshold = 10 ** -precision * list.length;

    if (mismatch === 0) return list;

    if (Math.abs(mismatch) >= maxMismatchThreshold) throw new Error(`Mismatch is too high. Mismatch: ${mismatch}`);

    let remainsToDistribute = mismatch;
    const correction = remainsToDistribute > 0 ? 10 ** -precision : -(10 ** -precision);

    return list.map((item) => {
      if (remainsToDistribute !== 0) {
        (item[key] as unknown as number) = Util.round((item[key] as unknown as number) + correction, precision);
        remainsToDistribute = Util.round(remainsToDistribute - correction, precision);
      }

      return item;
    });
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

  static secondsAfter(seconds: number, from?: Date): Date {
    const date = from ? new Date(from) : new Date();
    date.setSeconds(date.getSeconds() + seconds);
    return date;
  }

  static secondsBefore(seconds: number, from?: Date): Date {
    return this.secondsAfter(-seconds, from);
  }

  static minutesAfter(minutes: number, from?: Date): Date {
    const date = from ? new Date(from) : new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return date;
  }

  static minutesBefore(minutes: number, from?: Date): Date {
    return this.minutesAfter(-minutes, from);
  }

  static hoursAfter(hours: number, from?: Date): Date {
    const date = from ? new Date(from) : new Date();
    date.setHours(date.getHours() + hours);
    return date;
  }

  static hoursBefore(hours: number, from?: Date): Date {
    return this.hoursAfter(-hours, from);
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

  static isoDateTime(date: Date): string {
    return date.toISOString().split('.')[0].split(':').join('-').split('T').join('_');
  }

  // --- ENCRYPTION --- //

  static encrypt(input: string, key: string): string {
    const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(key, 'GfG', 32), Buffer.alloc(16, 0));

    let encrypted = cipher.update(input);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return encrypted.toString('hex');
  }

  static decrypt(input: string, key: string): string {
    const encryptedText = Buffer.from(input, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(key, 'GfG', 32), Buffer.alloc(16, 0));

    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
  }

  // --- CONVERT --- //

  static uint8ToString(array: Uint8Array, encoding: BufferEncoding): string {
    return Buffer.from(array).toString(encoding);
  }

  static stringToUint8(value: string, encoding: BufferEncoding): Uint8Array {
    return Uint8Array.from(Buffer.from(value, encoding));
  }

  // --- COMPARE --- //

  static equalsIgnoreCase(left: string, right: string): boolean {
    return left?.toLowerCase() === right?.toLowerCase();
  }

  static includesIgnoreCase(left: string[], right: string): boolean | undefined {
    return left?.map((s) => s?.toLowerCase()).includes(right?.toLowerCase());
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
        action().catch((e) => {
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

  static async doInBatches<T, U>(list: T[], action: (batch: T[]) => Promise<U>, batchSize: number): Promise<U[]> {
    const results: U[] = [];
    while (list.length > 0) {
      const batch = list.splice(0, batchSize);
      results.push(await action(batch));
    }

    return results;
  }

  static async doInBatchesAndJoin<T, U>(
    list: T[],
    action: (batch: T[]) => Promise<U[]>,
    batchSize: number,
  ): Promise<U[]> {
    const batches = await this.doInBatches(list, action, batchSize);
    return batches.reduce((prev, curr) => prev.concat(curr), []);
  }

  static async doGetFulfilled<T>(tasks: Promise<T>[]): Promise<T[]> {
    return Promise.allSettled(tasks).then((results) => results.filter(this.filterFulfilledCalls).map((r) => r.value));
  }

  private static filterFulfilledCalls<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
    return result.status === 'fulfilled';
  }

  public static async asyncFilter<T>(list: T[], filter: (i: T) => Promise<boolean>): Promise<T[]> {
    const filteredList: T[] = [];
    for (const item of list) {
      const isTrue = await filter(item);
      if (isTrue) filteredList.push(item);
    }
    return filteredList;
  }

  static async timeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    const timeoutPromise = new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout));

    return Promise.race([promise, timeoutPromise]);
  }

  static async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static removeNullFields(entity: any): void {
    Object.keys(entity).forEach((k) => entity[k] == null && delete entity[k]);
  }

  static createHash(
    data: BinaryLike,
    algo: CryptoAlgorithm = 'sha256',
    encoding: crypto.BinaryToTextEncoding = 'hex',
  ): string {
    const hash = createHash(algo);
    hash.update(data);
    return hash.digest(encoding);
  }

  static createSign(data: BinaryLike, key: KeyLike, algo: CryptoAlgorithm): string {
    const sign = createSign(algo);
    sign.update(data);
    return sign.sign(key, 'base64');
  }

  static async retry<T>(
    action: () => Promise<T>,
    tryCount = 3,
    delay = 0,
    onError?: () => Promise<unknown>,
  ): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (tryCount > 1) {
        await onError?.();
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

  static blankStart(value: string, visibleLength = 4): string {
    return '***' + value.slice(value.length - visibleLength);
  }

  static trim({ value }: TransformFnParams): string | undefined {
    return value?.split(' ').join('');
  }
}
