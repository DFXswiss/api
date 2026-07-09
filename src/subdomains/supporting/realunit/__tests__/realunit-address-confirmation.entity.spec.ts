import { RealUnitAddressConfirmation } from '../entities/realunit-address-confirmation.entity';

describe('RealUnitAddressConfirmation', () => {
  it('serialises responseData to a JSON string via the setter', () => {
    const entity = new RealUnitAddressConfirmation();
    entity.responseData = { status: 403, message: 'Code not found' };
    expect(entity.response).toBe('{"status":403,"message":"Code not found"}');
  });

  it('parses responseData from the JSON string via the getter', () => {
    const entity = new RealUnitAddressConfirmation();
    entity.response = '{"status":200}';
    expect(entity.responseData).toEqual({ status: 200 });
  });

  it('returns undefined from the getter when no response is stored', () => {
    const entity = new RealUnitAddressConfirmation();
    expect(entity.responseData).toBeUndefined();
  });

  it('clears the response column when the setter receives null', () => {
    const entity = new RealUnitAddressConfirmation();
    entity.response = '{"a":1}';
    entity.responseData = null;
    expect(entity.response).toBeNull();
  });

  it('clears the response column when the setter receives undefined', () => {
    const entity = new RealUnitAddressConfirmation();
    entity.response = '{"a":1}';
    entity.responseData = undefined;
    expect(entity.response).toBeNull();
  });
});
