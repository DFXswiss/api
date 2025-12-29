export abstract class StrategyRegistry<K, S> {
  private readonly registry: Map<string, S> = new Map();

  add(key: K, strategy: S) {
    this.registry.set(this.getKey(key), strategy);
  }

  remove(key: K) {
    this.registry.delete(this.getKey(key));
  }

  get(key: K): S {
    return this.registry.get(this.getKey(key));
  }

  protected getKey(key: K): string {
    return JSON.stringify(key);
  }
}
