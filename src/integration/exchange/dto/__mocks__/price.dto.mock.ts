import { Price } from '../../../../subdomains/supporting/pricing/domain/entities/price';

export function createDefaultPrice(): Price {
  return createCustomPrice({});
}

export function createCustomPrice(customValues: Partial<Price>): Price {
  const { source, target, price } = customValues;
  const keys = Object.keys(customValues);

  const entity = new Price();

  entity.source = keys.includes('source') ? source : 'BTC';
  entity.target = keys.includes('target') ? target : 'USDT';
  entity.price = keys.includes('price') ? price : 10;

  return entity;
}
