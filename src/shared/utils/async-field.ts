/**
 * A lazy-loaded async field that executes on first access.
 * Implements Promise<T> so it can be directly awaited.
 */
export class AsyncField<T> implements Promise<T> {
  private internalPromise?: Promise<T>;
  private resolvedValue?: T;

  constructor(
    private readonly executor: () => Promise<T>,
    readonly eager = false,
  ) {
    if (eager) void this.promise.catch(() => undefined);
  }

  private get promise(): Promise<T> {
    if (!this.internalPromise) {
      this.internalPromise = this.executor().then((value) => {
        return (this.resolvedValue = value);
      });
    }

    return this.internalPromise;
  }

  get value(): T | undefined {
    return this.resolvedValue;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<T | TResult> {
    return this.promise.catch(onrejected);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this.promise.finally(onfinally);
  }

  [Symbol.toStringTag] = 'AsyncField';
}

/**
 * A field populated by a subscription callback. Awaiting resolves once the first value arrives.
 * Subsequent updates keep the value fresh via the `current` property.
 * Implements Promise<T> so it can be directly awaited.
 */
export class AsyncSubscription<T> implements Promise<T> {
  private value!: T;
  private ready: Promise<T>;
  private resolveReady!: (value: T) => void;
  private isReady = false;

  constructor(subscribe: (callback: (value: T) => void) => void) {
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));

    subscribe((value) => {
      this.value = value;
      if (!this.isReady) {
        this.isReady = true;
        this.resolveReady(value);
      }
    });
  }

  get current(): T {
    return this.value;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.ready.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<T | TResult> {
    return this.ready.catch(onrejected);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this.ready.finally(onfinally);
  }

  [Symbol.toStringTag] = 'AsyncSubscription';
}
