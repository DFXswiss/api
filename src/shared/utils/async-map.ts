export interface Subscriber<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class AsyncMap<K, T> {
  private readonly subscribers = new Map<K, Subscriber<T>>();

  constructor(public readonly name?: string) {}

  public wait(id: K, timeout: number): Promise<T> {
    const existing = this.subscribers.get(id);
    if (existing) return existing.promise;

    const subscriber = {} as Subscriber<T>;
    const promise = new Promise<T>((resolve, reject) => {
      subscriber.resolve = resolve;
      subscriber.reject = reject;

      if (timeout) {
        subscriber.timer = setTimeout(
          () => this.reject(id, `${id} timed out` + (this.name ? ` in ${this.name}` : '')),
          timeout,
        );
      }
    });
    subscriber.promise = promise;

    this.subscribers.set(id, subscriber);

    return promise;
  }

  public get(): K[] {
    return Array.from(this.subscribers.keys());
  }

  public resolve(id: K, value: T) {
    const subscriber = this.subscribers.get(id);
    if (subscriber) {
      clearTimeout(subscriber.timer);
      subscriber.resolve(value);
      this.subscribers.delete(id);
    }
  }

  public reject(id: K, reason: string) {
    const subscriber = this.subscribers.get(id);
    if (subscriber) {
      clearTimeout(subscriber.timer);
      subscriber.reject(new Error(reason));
      this.subscribers.delete(id);
    }
  }
}
