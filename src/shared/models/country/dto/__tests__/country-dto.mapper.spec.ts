import { createCustomCountry } from '../../__mocks__/country.entity.mock';
import { CountryDtoMapper } from '../country-dto.mapper';

/**
 * Characterisation / regression coverage for CountryDtoMapper flag derivation.
 * The mapper itself is unchanged by the FATF block PR; these tests lock the public DTO contract
 * for the post-migration country flag matrix (blocked FATF jurisdictions, over-blocks, Panama).
 */
describe('CountryDtoMapper', () => {
  it('maps BA in the post-block state to fully restricted public allow-flags (except crypto)', () => {
    const dto = CountryDtoMapper.entityToDto(
      createCustomCountry({
        symbol: 'BA',
        name: 'Bosnia and Herzegovina',
        fatfEnable: false,
        dfxEnable: false,
        nationalityStepEnable: false,
        bankEnable: true,
        checkoutEnable: true,
        cryptoEnable: true,
        ipEnable: true,
      }),
    );

    expect(dto).toMatchObject({
      symbol: 'BA',
      ibanAllowed: false,
      kycAllowed: false,
      nationalityAllowed: false,
      bankAllowed: false,
      cardAllowed: false,
      cryptoAllowed: true,
      locationAllowed: true,
    });
  });

  it('maps CD in the post-block state as blocked', () => {
    const dto = CountryDtoMapper.entityToDto(
      createCustomCountry({
        symbol: 'CD',
        name: 'Democratic Republic of the Congo',
        fatfEnable: false,
        dfxEnable: false,
        nationalityStepEnable: false,
        bankEnable: true,
        checkoutEnable: true,
        cryptoEnable: true,
        ipEnable: true,
      }),
    );

    expect(dto).toMatchObject({
      symbol: 'CD',
      ibanAllowed: false,
      kycAllowed: false,
      nationalityAllowed: false,
      bankAllowed: false,
      cardAllowed: false,
    });
  });

  it('maps CG as blocked (intentional over-block, unchanged by this PR)', () => {
    const dto = CountryDtoMapper.entityToDto(
      createCustomCountry({
        symbol: 'CG',
        name: 'Congo',
        fatfEnable: false,
        dfxEnable: false,
        nationalityStepEnable: false,
        bankEnable: true,
        checkoutEnable: true,
        cryptoEnable: true,
        ipEnable: true,
      }),
    );

    expect(dto).toMatchObject({
      symbol: 'CG',
      ibanAllowed: false,
      kycAllowed: false,
      nationalityAllowed: false,
      bankAllowed: false,
      cardAllowed: false,
    });
  });

  it('maps PA as allowed for IBAN and card (not FATF-listed, unchanged)', () => {
    const dto = CountryDtoMapper.entityToDto(
      createCustomCountry({
        symbol: 'PA',
        name: 'Panama',
        fatfEnable: true,
        dfxEnable: true,
        nationalityStepEnable: true,
        bankEnable: true,
        checkoutEnable: true,
        cryptoEnable: true,
        ipEnable: true,
      }),
    );

    expect(dto).toMatchObject({
      symbol: 'PA',
      ibanAllowed: true,
      cardAllowed: true,
      kycAllowed: true,
      nationalityAllowed: true,
      bankAllowed: true,
      cryptoAllowed: true,
      locationAllowed: true,
    });
  });

  it.each(['IR', 'KP', 'MM'] as const)(
    'maps call-for-action jurisdiction %s as blocked with locationAllowed=false',
    (symbol) => {
      const dto = CountryDtoMapper.entityToDto(
        createCustomCountry({
          symbol,
          fatfEnable: false,
          dfxEnable: false,
          nationalityStepEnable: false,
          bankEnable: true,
          checkoutEnable: true,
          cryptoEnable: true,
          ipEnable: false,
        }),
      );

      expect(dto).toMatchObject({
        symbol,
        ibanAllowed: false,
        kycAllowed: false,
        nationalityAllowed: false,
        bankAllowed: false,
        cardAllowed: false,
        cryptoAllowed: true,
        locationAllowed: false,
      });
    },
  );

  it('derives cardAllowed as checkoutEnable && fatfEnable (false when fatfEnable is false)', () => {
    const dto = CountryDtoMapper.entityToDto(
      createCustomCountry({
        symbol: 'XX',
        fatfEnable: false,
        checkoutEnable: true,
        dfxEnable: true,
        bankEnable: true,
      }),
    );
    expect(dto.cardAllowed).toBe(false);
  });

  it('derives bankAllowed as bankEnable && dfxEnable (false when bankEnable is false)', () => {
    const dto = CountryDtoMapper.entityToDto(
      createCustomCountry({
        symbol: 'YY',
        fatfEnable: true,
        checkoutEnable: true,
        dfxEnable: true,
        bankEnable: false,
      }),
    );
    expect(dto.bankAllowed).toBe(false);
  });
});
