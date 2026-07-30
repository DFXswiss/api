import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { createCustomBank } from 'src/subdomains/supporting/bank/bank/__mocks__/bank.entity.mock';
import { createCustomVirtualIban } from 'src/subdomains/supporting/bank/virtual-iban/__mocks__/virtual-iban.entity.mock';
import { VirtualIbanMapper } from 'src/subdomains/supporting/bank/virtual-iban/dto/virtual-iban.mapper';

describe('VirtualIbanMapper', () => {
  it.each([false, true])('maps bank.receive=%s to acceptsPayments', (receive) => {
    const virtualIban = createCustomVirtualIban({
      bank: createCustomBank({ receive }),
      currency: createDefaultFiat(),
    });

    expect(VirtualIbanMapper.toDto(virtualIban).acceptsPayments).toBe(receive);
  });
});
