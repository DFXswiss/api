import { Transform } from 'class-transformer';

export const StringToArray = (): PropertyDecorator =>
  Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : value,
  );
