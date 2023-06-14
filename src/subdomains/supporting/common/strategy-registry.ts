export abstract class StrategyRegistry<K, S> {
  private registry: Map<string, S> = new Map();

  addStrategy(key: K, strategy: S) {
    this.registry.set(this.getKey(key), strategy);
  }

  removeStrategy(key: K) {
    this.registry.delete(this.getKey(key));
  }

  getStrategy(key: K): S {
    return this.registry.get(this.getKey(key));
  }

  private getKey(key: K): string {
    return JSON.stringify(key);
  }
}
