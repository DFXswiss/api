import { LogRejectedValue, logsRejectedValues } from 'src/shared/decorators/log-rejected-value.decorator';

class Marked {
  @LogRejectedValue()
  method: string;

  @LogRejectedValue()
  mode: string;

  free: string;
}

class Unmarked {
  method: string;
}

class Inheriting extends Marked {
  @LogRejectedValue()
  own: string;
}

describe('LogRejectedValue', () => {
  it('collects every marked property of a class', () => {
    expect([...logsRejectedValues(Marked)].sort()).toEqual(['method', 'mode']);
  });

  it('leaves an unmarked property out', () => {
    expect(logsRejectedValues(Marked).has('free')).toBe(false);
  });

  it('reports nothing for a class that marks nothing', () => {
    expect(logsRejectedValues(Unmarked).size).toBe(0);
  });

  it('reports nothing for anything that is not a class', () => {
    expect(logsRejectedValues(undefined).size).toBe(0);
    expect(logsRejectedValues({ method: 1 }).size).toBe(0);
    expect(logsRejectedValues('Marked').size).toBe(0);
  });

  it('inherits what a parent marked without a subclass reaching back into it', () => {
    expect([...logsRejectedValues(Inheriting)].sort()).toEqual(['method', 'mode', 'own']);
    expect([...logsRejectedValues(Marked)].sort()).toEqual(['method', 'mode']);
  });
});
