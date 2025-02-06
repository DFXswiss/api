import BigNumber from 'bignumber.js';
import { TransformFnParams } from 'class-transformer';
import * as crypto from 'crypto';
import { BinaryLike, createHash, createHmac, createSign, createVerify, KeyLike } from 'crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { readFile } from 'fs';

export type KeyType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

type CryptoAlgorithm = 'md5' | 'sha256' | 'sha512';

export class Util {
  // --- MATH --- //
  static roundReadable(amount: number, isFiat: boolean, assetPrecision?: number): number {
    return isFiat
      ? amount < 0.01
        ? this.round(amount, 2)
        : this.ceil(amount, 2)
      : this.roundByPrecision(amount, assetPrecision ?? 5);
  }

  static round(amount: number, decimals: number): number {
    return this.roundToValue(amount, Math.pow(10, -decimals));
  }

  static roundToValue(amount: number, value: number): number {
    return new BigNumber(Math.round(amount / value)).multipliedBy(value).toNumber();
  }

  static floor(amount: number, decimals: number): number {
    return this.floorToValue(amount, Math.pow(10, -decimals));
  }

  static floorToValue(amount: number, value: number): number {
    return new BigNumber(Math.floor(amount / value)).multipliedBy(value).toNumber();
  }

  static ceil(amount: number, decimals: number): number {
    return this.ceilToValue(amount, Math.pow(10, -decimals));
  }

  static ceilToValue(amount: number, value: number): number {
    return new BigNumber(Math.ceil(amount / value)).multipliedBy(value).toNumber();
  }

  static toPercent(num: number): string {
    return `${this.round(num * 100, 2)}%`;
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

  static minObj<T>(list: T[], key: KeyType<T, number | Date>): T {
    return list.reduce((i, j) => (i && j[key] >= i[key] ? i : j), undefined);
  }

  static maxObj<T>(list: T[], key: KeyType<T, number | Date>): T {
    return list.reduce((i, j) => (i && j[key] <= i[key] ? i : j), undefined);
  }

  static sort<T>(list: T[], key: KeyType<T, number> | KeyType<T, Date>, sorting: 'ASC' | 'DESC' = 'ASC'): T[] {
    return list.sort((a, b) => (sorting === 'ASC' ? Number(a[key]) - Number(b[key]) : Number(b[key]) - Number(a[key])));
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

  static isSameName(input1: string, input2: string): boolean {
    if (!input1 || !input2) return false;

    const array1 = this.removeSpecialChars(input1).split(' ');
    const array2 = this.removeSpecialChars(input2).split(' ');

    return (
      array1.every((element) => array2.some((i) => i.includes(element))) ||
      array2.every((element) => array1.some((i) => i.includes(element)))
    );
  }

  static includesSameName(reference: string, testedName: string): boolean {
    if (!reference || !testedName) return false;

    const referenceArray = this.removeSpecialChars(reference).split(' ');
    const testedNameArray = this.removeSpecialChars(testedName).split(' ');

    return testedNameArray.some((n) => referenceArray.includes(n));
  }

  static removeSpecialChars(name: string): string {
    return name
      .toLowerCase()
      .replace(/[ýÿ]/g, 'y')
      .replace(/[ìíîïyī]/g, 'i')
      .replace(/[ùúûüū]/g, 'u')
      .replace(/[àáâăåäãā]/g, 'a')
      .replace(/[èéêëė]/g, 'e')
      .replace(/[òóôöõō]/g, 'o')
      .replace(/ae/g, 'a')
      .replace(/ue/g, 'u')
      .replace(/oe/g, 'o')
      .replace(/[ñń]/g, 'n')
      .replace(/[ł]/g, 'l')
      .replace(/[f]/g, 'ph')
      .replace(/[çčć]/g, 'c')
      .replace(/[ßșšś]/g, 's')
      .replace(/ss/g, 's')
      .replace(/[žż]/g, 'z')
      .replace(/[\.,]/g, '')
      .replace(/[-‘`´']/g, ' ');
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
    return ((to?.getTime() ?? Date.now()) - (from?.getTime() ?? 0)) / 1000;
  }

  static minutesDiff(from?: Date, to?: Date): number {
    return this.secondsDiff(from, to) / 60;
  }

  static hoursDiff(from?: Date, to?: Date): number {
    return this.secondsDiff(from, to) / 3600;
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
    return date.toISOString().split('.')[0].replace(/:/g, '-').replace(/T/g, '_');
  }

  static isoTime(date: Date): string {
    return date.toISOString().split('.')[0].split('T')[1].replace(/:/g, '-');
  }

  static firstDayOfMonth(date = new Date()): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  static lastDayOfMonth(date = new Date()): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
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
    const listCopy = [...list];
    const results: U[] = [];
    while (listCopy.length > 0) {
      const batch = listCopy.splice(0, batchSize);
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

  public static async asyncMap<T, U>(list: T[], map: (i: T) => Promise<U>): Promise<U[]> {
    const mappedList: U[] = [];
    for (const item of list) {
      const mappedItem = await map(item);
      mappedList.push(mappedItem);
    }
    return mappedList;
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

  static createObjectHash(
    data: object,
    algo: CryptoAlgorithm = 'sha256',
    encoding: crypto.BinaryToTextEncoding = 'hex',
  ): string {
    return this.createHash(JSON.stringify(data), algo, encoding);
  }

  static createUniqueId(prefix: string, length = 6): string {
    const hash = this.createHash(`${Date.now()}${Util.randomId()}`).toLowerCase();
    return `${prefix}_${hash.slice(0, length)}`;
  }

  static createSign(
    data: BinaryLike,
    key: KeyLike,
    algo: CryptoAlgorithm = 'sha256',
    encoding: crypto.BinaryToTextEncoding = 'base64',
  ): string {
    const sign = createSign(algo);
    sign.update(data);
    return sign.sign(key, encoding);
  }

  static verifySign(
    data: BinaryLike,
    key: KeyLike,
    signature: string,
    algo: CryptoAlgorithm = 'sha256',
    encoding: crypto.BinaryToTextEncoding = 'base64',
  ): boolean {
    const verify = createVerify(algo);
    verify.update(data);
    return verify.verify(key, signature, encoding);
  }

  static createHmac(
    key: BinaryLike,
    data: BinaryLike,
    algo: CryptoAlgorithm = 'sha256',
    encoding: crypto.BinaryToTextEncoding = 'hex',
  ): string {
    const hmac = createHmac(algo, key);
    hmac.update(data);
    return hmac.digest(encoding);
  }

  static async retry<T>(
    action: () => Promise<T>,
    tryCount = 3,
    delay = 0,
    onError?: () => Promise<unknown>,
    retryIf?: (e: Error) => boolean,
  ): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (tryCount > 1 && (!retryIf || retryIf(e))) {
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

    return new XMLParser({ ignoreAttributes: false, numberParseOptions: { leadingZeros: false, hex: false } }).parse(
      file,
    );
  }

  static blankCenter(value: string, visibleLength = 4): string {
    return value.slice(0, visibleLength) + this.blankStart(value, visibleLength);
  }

  static blankStart(value: string, visibleLength = 4): string {
    return '***' + value.slice(value.length - visibleLength);
  }

  static blankMail(value: string, visibleLength = 4): string {
    const mailSplit = value.split('@');
    return `${mailSplit[0].slice(0, visibleLength)}***@${mailSplit[1]}`;
  }

  static trimAll({ value }: TransformFnParams): string | undefined {
    return value?.replace(/ /g, '');
  }

  static trim({ value }: TransformFnParams): string | undefined {
    return value?.trim();
  }

  static mapBooleanQuery({ value }: TransformFnParams): boolean | undefined {
    return Boolean(value || value === '');
  }

  static fromBase64(file: string): { contentType: string; buffer: Buffer } {
    const [contentType, content] = file.split(';base64,');
    return { contentType: contentType.replace('data:', ''), buffer: Buffer.from(content, 'base64') };
  }

  static toCsv(list: any[], separator = ',', toGermanLocalDateString = false): string {
    const headers = Object.keys(list[0]).join(separator);
    const values = list.map((t) =>
      Object.values(t)
        .map((v) =>
          v instanceof Date
            ? toGermanLocalDateString
              ? v.toLocaleString('de-DE', { timeZone: 'CET' })
              : v.toISOString()
            : v,
        )
        .join(separator),
    );
    return [headers].concat(values).join('\n');
  }

  static toEnum<T>(enumObj: T, value?: string): T[keyof T] | undefined {
    return Object.values(enumObj).find((e) => e.toLowerCase() === value?.toLowerCase());
  }

  static createTimeString(times: number[], checkRuntime = 1): string | undefined {
    const total = Util.round((Date.now() - times[0]) / 1000, 3);

    if (total > checkRuntime) {
      const timeString = times.map((t, i, a) => Util.round((t - (a[i - 1] ?? t)) / 1000, 3)).join(', ');
      return `${timeString} (total ${total})`;
    }
  }
}
