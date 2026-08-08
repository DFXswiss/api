import { PriceStep } from '../price';
import { PriceRule, PriceSource } from '../price-rule.entity';
import { PricingProvider } from '../../../services/integration/pricing-provider';
import { PricingProviderMap } from '../../interfaces';

/**
 * Pins the dual-sided getPrice step contract: the numeric quote and the customer-visible
 * price.steps provenance must both carry the sell side when preferSellPrice is set.
 * A silent fall-through to the provider step (always currentPrice/ask) would leave convert()
 * correct while price.steps still advertised the ask.
 */
describe('PriceRule#getPrice steps', () => {
  const askDivisor = 1 / 4511.00359;
  const bidDivisor = 1 / 4259.41142;

  /** Minimal provider that only implements getPriceStep via the base class. */
  class StubProvider extends PricingProvider {
    async getPrice(): Promise<never> {
      throw new Error('not used');
    }
  }

  const providers = {
    [PriceSource.DENARIO]: new StubProvider(),
  } as unknown as PricingProviderMap;

  const createRule = (partial: Partial<PriceRule> = {}): PriceRule =>
    Object.assign(new PriceRule(), {
      id: 1,
      priceSource: PriceSource.DENARIO,
      priceAsset: 'DGC',
      priceReference: 'USD',
      assetDisplayName: 'DGC',
      referenceDisplayName: 'USD',
      currentPrice: askDivisor,
      priceTimestamp: new Date('2026-08-06T12:00:00Z'),
      priceValiditySeconds: 300,
      ...partial,
    });

  it('preferSellPrice with currentSellPrice: step.price is the sell value, labels stay from the provider', () => {
    const rule = createRule({
      sellPriceSource: 'Denario:bid',
      currentSellPrice: bidDivisor,
    });

    const providerStep = providers[PriceSource.DENARIO].getPriceStep(rule);
    // Precondition: the provider step always carries the buy/ask side.
    expect(providerStep.price).toBe(
      PriceStep.create(providerStep.source, providerStep.from, providerStep.to, askDivisor).price,
    );
    expect(providerStep.price).not.toBe(
      PriceStep.create(providerStep.source, providerStep.from, providerStep.to, bidDivisor).price,
    );

    const price = rule.getPrice(providers, true);
    expect(price.steps).toHaveLength(1);
    const step = price.steps[0];

    // Provenance labels unchanged from the provider step (source/from/to).
    expect(step.source).toBe(providerStep.source);
    expect(step.from).toBe(providerStep.from);
    expect(step.to).toBe(providerStep.to);

    // Price value must be the sell side, not the ask the provider step still holds.
    const expectedSellStepPrice = PriceStep.create(
      providerStep.source,
      providerStep.from,
      providerStep.to,
      bidDivisor,
    ).price;
    expect(step.price).toBe(expectedSellStepPrice);
    expect(step.price).not.toBe(providerStep.price);
    // Anti-mutation: a fall-through `const step = false ? … : providerStep` would leave ask.
    expect(step.price).not.toBe(
      PriceStep.create(providerStep.source, providerStep.from, providerStep.to, askDivisor).price,
    );

    // Quote amount and step stay consistent on the sell side.
    expect(price.price).toBe(bidDivisor);
    expect(Math.abs(price.convert(1) - 4259.41142)).toBeLessThanOrEqual(0.0001);
  });

  it('without sell preference (or without currentSellPrice): step is the unaltered provider step', () => {
    const withSellConfigured = createRule({
      sellPriceSource: 'Denario:bid',
      currentSellPrice: bidDivisor,
    });
    const providerStep = providers[PriceSource.DENARIO].getPriceStep(withSellConfigured);

    // preferSellPrice=false: buy path, even though currentSellPrice is present.
    const buyPrice = withSellConfigured.getPrice(providers, false);
    expect(buyPrice.steps).toHaveLength(1);
    expect(buyPrice.steps[0]).toEqual(providerStep);
    expect(buyPrice.steps[0].price).toBe(providerStep.price);
    expect(buyPrice.price).toBe(askDivisor);

    // No currentSellPrice: preferSellPrice is a no-op, provider step unchanged.
    const singleSided = createRule();
    const singleProviderStep = providers[PriceSource.DENARIO].getPriceStep(singleSided);
    const singlePrice = singleSided.getPrice(providers, true);
    expect(singlePrice.steps).toHaveLength(1);
    expect(singlePrice.steps[0]).toEqual(singleProviderStep);
    expect(singlePrice.steps[0].price).toBe(singleProviderStep.price);
    expect(singlePrice.price).toBe(askDivisor);
  });
});
