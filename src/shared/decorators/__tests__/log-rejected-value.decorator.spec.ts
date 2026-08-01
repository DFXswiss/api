import { LogRejectedValue, loggableRejectedValues } from 'src/shared/decorators/log-rejected-value.decorator';

enum Mode {
  FAST = 'Fast',
  SLOW = 'Slow',
}

enum Speed {
  LOW = 0,
  HIGH = 1,
}

class Declaring {
  @LogRejectedValue(Mode)
  mode: string;

  @LogRejectedValue(['Bank', 'Crypto'])
  method: string;

  free: string;
}

class Silent {
  mode: string;
}

class Numeric {
  @LogRejectedValue(Speed)
  speed: number;
}

class Extending extends Declaring {
  @LogRejectedValue([1, 2, true])
  own: string;
}

describe('LogRejectedValue', () => {
  it('takes the values of an enum object', () => {
    expect([...(loggableRejectedValues(Declaring, 'mode') ?? [])]).toEqual([
      ['fast', 'Fast'],
      ['slow', 'Slow'],
    ]);
  });

  it('takes a plain list, including numbers and booleans', () => {
    expect([...(loggableRejectedValues(Extending, 'own') ?? [])]).toEqual([
      ['1', '1'],
      ['2', '2'],
      ['true', 'true'],
    ]);
  });

  it('leaves the reverse mapping of a numeric enum out', () => {
    // `{ LOW: 0, HIGH: 1 }` reads back as `['LOW', 'HIGH', 0, 1]`: the member names are not values
    // the field accepts, and taking them would match a request that sent one of them.
    expect([...(loggableRejectedValues(Numeric, 'speed') ?? [])]).toEqual([
      ['0', '0'],
      ['1', '1'],
    ]);
  });

  it('reports nothing for a property that declared nothing', () => {
    expect(loggableRejectedValues(Declaring, 'free')).toBeUndefined();
    expect(loggableRejectedValues(Silent, 'mode')).toBeUndefined();
  });

  it('reports nothing for anything that is not a class', () => {
    expect(loggableRejectedValues(undefined, 'mode')).toBeUndefined();
    expect(loggableRejectedValues({ mode: 1 }, 'mode')).toBeUndefined();
    expect(loggableRejectedValues('Declaring', 'mode')).toBeUndefined();
  });

  it('inherits what a parent declared without a subclass reaching back into it', () => {
    expect(loggableRejectedValues(Extending, 'mode')?.get('fast')).toBe('Fast');
    expect(loggableRejectedValues(Declaring, 'own')).toBeUndefined();
  });
});
