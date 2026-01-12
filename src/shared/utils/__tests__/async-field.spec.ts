import { AsyncField } from '../async-field';

describe('AsyncField', () => {
  let mockExecutor: jest.Mock;
  let mockValue: string;

  beforeEach(() => {
    mockValue = 'test-value';
    mockExecutor = jest.fn().mockResolvedValue(mockValue);
  });

  describe('constructor', () => {
    it('should create instance without executing when eager is false', () => {
      void new AsyncField(mockExecutor, false);
      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it('should create instance without executing when eager is not specified', () => {
      void new AsyncField(mockExecutor);
      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it('should execute immediately when eager is true', async () => {
      void new AsyncField(mockExecutor, true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });
  });

  describe('value property', () => {
    it('should return undefined before execution', () => {
      const field = new AsyncField(mockExecutor);
      expect(field.value).toBeUndefined();
    });

    it('should return resolved value after await', async () => {
      const field = new AsyncField(mockExecutor);
      await field;
      expect(field.value).toBe(mockValue);
    });

    it('should return resolved value after then', async () => {
      const field = new AsyncField(mockExecutor);
      await field.then(() => undefined);
      expect(field.value).toBe(mockValue);
    });
  });

  describe('promise execution', () => {
    it('should execute only once on multiple accesses', async () => {
      const field = new AsyncField(mockExecutor);

      await Promise.all([field, field, field]);

      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it('should return consistent results on multiple accesses', async () => {
      const field = new AsyncField(mockExecutor);

      const result1 = await field.then((v) => v);
      const result2 = await field.then((v) => v);

      expect(result1).toBe(result2);
      expect(result1).toBe(mockValue);
    });
  });

  describe('then method', () => {
    it('should work like a promise', async () => {
      const field = new AsyncField(mockExecutor);
      const result = await field.then((value: string) => value.toUpperCase());

      expect(result).toBe('TEST-VALUE');
      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it('should handle rejection', async () => {
      const error = new Error('Test error');
      const rejectedExecutor = jest.fn().mockRejectedValue(error);
      const field = new AsyncField(rejectedExecutor);

      await expect(field.then((v) => v)).rejects.toThrow('Test error');
    });

    it('should handle onrejected callback', async () => {
      const error = new Error('Test error');
      const rejectedExecutor = jest.fn().mockRejectedValue(error);
      const field = new AsyncField(rejectedExecutor);

      const result = await field.then(
        (v) => v,
        (_err) => 'recovered',
      );

      expect(result).toBe('recovered');
    });
  });

  describe('catch method', () => {
    it('should handle errors', async () => {
      const error = new Error('Test error');
      const rejectedExecutor = jest.fn().mockRejectedValue(error);
      const field = new AsyncField(rejectedExecutor);

      const result = await field.catch((_err) => 'caught error');

      expect(result).toBe('caught error');
    });

    it('should pass through resolved values', async () => {
      const field = new AsyncField(mockExecutor);
      const result = await field.catch(() => 'this should not be called');

      expect(result).toBe(mockValue);
    });
  });

  describe('finally method', () => {
    it('should execute cleanup on success', async () => {
      const cleanup = jest.fn();
      const field = new AsyncField(mockExecutor);

      const result = await field.finally(cleanup);

      expect(result).toBe(mockValue);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('should execute cleanup on error', async () => {
      const cleanup = jest.fn();
      const error = new Error('Test error');
      const rejectedExecutor = jest.fn().mockRejectedValue(error);
      const field = new AsyncField(rejectedExecutor);

      await expect(field.finally(cleanup)).rejects.toThrow('Test error');
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe('async/await compatibility', () => {
    it('should work with async/await', async () => {
      const field = new AsyncField(mockExecutor);
      const result = await field;

      expect(result).toBe(mockValue);
    });

    it('should work in Promise.all', async () => {
      const field1 = new AsyncField(() => Promise.resolve('value1'));
      const field2 = new AsyncField(() => Promise.resolve('value2'));

      const results = await Promise.all([field1, field2]);

      expect(results).toEqual(['value1', 'value2']);
    });

    it('should work in Promise.race', async () => {
      const field1 = new AsyncField(() => new Promise((resolve) => setTimeout(() => resolve('slow'), 100)));
      const field2 = new AsyncField(() => Promise.resolve('fast'));

      const result = await Promise.race([field1, field2]);

      expect(result).toBe('fast');
    });
  });

  describe('error handling', () => {
    it('should propagate executor errors', async () => {
      const error = new Error('Executor failed');
      const rejectedExecutor = jest.fn().mockRejectedValue(error);
      const field = new AsyncField(rejectedExecutor);

      await expect(field).rejects.toThrow('Executor failed');
    });

    it('should not store value on error', async () => {
      const error = new Error('Executor failed');
      const rejectedExecutor = jest.fn().mockRejectedValue(error);
      const field = new AsyncField(rejectedExecutor);

      try {
        await field;
      } catch (e) {
        // Expected
      }

      expect(field.value).toBeUndefined();
    });
  });

  describe('lazy evaluation', () => {
    it('should not execute until needed', () => {
      const field = new AsyncField(mockExecutor);

      // Access value property - should not trigger execution
      expect(field.value).toBeUndefined();
      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it('should execute on first then call', () => {
      const field = new AsyncField(mockExecutor);

      void field.then(() => undefined);

      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it('should execute on first catch call', () => {
      const field = new AsyncField(mockExecutor);

      void field.catch(() => undefined);

      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it('should execute on first finally call', () => {
      const field = new AsyncField(mockExecutor);

      void field.finally(() => undefined);

      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });
  });

  describe('eager evaluation', () => {
    it('should suppress errors in eager mode', () => {
      const error = new Error('Test error');
      const rejectedExecutor = jest.fn().mockRejectedValue(error);

      // This should not throw
      expect(() => new AsyncField(rejectedExecutor, true)).not.toThrow();
    });

    it('should still allow error handling after eager execution fails', async () => {
      const error = new Error('Test error');
      const rejectedExecutor = jest.fn().mockRejectedValue(error);
      const field = new AsyncField(rejectedExecutor, true);

      await expect(field).rejects.toThrow('Test error');
    });
  });

  describe('type compatibility', () => {
    it('should work with different return types', async () => {
      const numberField = new AsyncField(() => Promise.resolve(42));
      const objectField = new AsyncField(() => Promise.resolve({ key: 'value' }));
      const arrayField = new AsyncField(() => Promise.resolve([1, 2, 3]));

      expect(await numberField).toBe(42);
      expect(await objectField).toEqual({ key: 'value' });
      expect(await arrayField).toEqual([1, 2, 3]);
    });

    it('should maintain type information', async () => {
      const field = new AsyncField<number>(() => Promise.resolve(42));

      const result: number = await field;
      expect(typeof result).toBe('number');
      expect(result).toBe(42);
    });
  });

  describe('Symbol.toStringTag', () => {
    it('should have toStringTag property set to AsyncField', () => {
      const field = new AsyncField(mockExecutor);
      expect(field[Symbol.toStringTag]).toBe('AsyncField');
    });
  });
});
