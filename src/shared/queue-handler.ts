import { SchedulerRegistry } from '@nestjs/schedule';
import { Lock } from './lock';
import { Util } from './util';

class QueueItem<T> {
  private readonly timeout: NodeJS.Timeout;
  private readonly promise: Promise<T>;

  private resolve: (value: T | PromiseLike<T>) => void;
  private reject: () => void;

  constructor(private readonly action: () => Promise<T>, timeout?: number) {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = (v) => {
        resolve(v);
        if (this.timeout) clearTimeout(this.timeout);
      };
      this.reject = reject;
    });
    if (timeout) this.timeout = setTimeout(this.reject, timeout);
  }

  public wait(): Promise<T> {
    return this.promise;
  }

  public async doWork() {
    await this.action().then(this.resolve).catch(this.reject);
  }
}

export class QueueHandler {
  private readonly lock = new Lock(5);
  private readonly queue: QueueItem<any>[] = [];

  constructor(scheduler: SchedulerRegistry, private readonly timeout?: number) {
    const interval = setInterval(() => this.doWork(), 50);
    scheduler.addInterval(Util.randomId().toString(), interval);
  }

  async handle<T>(action: () => Promise<T>): Promise<T> {
    const item = new QueueItem(action, this.timeout);
    this.queue.push(item);
    return await item.wait();
  }

  async doWork() {
    if (!this.lock.acquire()) return;

    try {
      while (this.queue.length > 0) {
        await this.queue.shift().doWork();
      }
    } catch {}

    this.lock.release();
  }
}
