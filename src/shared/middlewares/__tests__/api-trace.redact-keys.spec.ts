import 'reflect-metadata';
import { KycAddress, KycPersonalData } from 'src/subdomains/generic/kyc/dto/input/kyc-data.dto';
import * as realunitAdminDto from 'src/subdomains/supporting/realunit/dto/realunit-admin.dto';
import * as realunitPdfDto from 'src/subdomains/supporting/realunit/dto/realunit-pdf.dto';
import * as realunitRegistrationDto from 'src/subdomains/supporting/realunit/dto/realunit-registration.dto';
import * as realunitSellDto from 'src/subdomains/supporting/realunit/dto/realunit-sell.dto';
import * as realunitDto from 'src/subdomains/supporting/realunit/dto/realunit.dto';
import { REDACT_KEY } from '../api-trace.middleware';

// Regression net for the REDACT_KEY denylist: every property of every DTO that
// can flow through the RealUnit trace must either match REDACT_KEY or be
// explicitly listed here as safe to log. A new personal field on a RealUnit DTO
// fails this spec instead of shipping to PRD logs unmasked.
const SAFE_KEYS = new Set([
  // ids / enums / status
  'id',
  'uid',
  'routeId',
  'chainId',
  'type',
  'status',
  'state',
  'eventType',
  'accountType',
  'isRegistered',
  'isValid',
  'error',
  'reference',
  // amounts / rates / volumes
  'amount',
  'targetAmount',
  'estimatedAmount',
  'amountInChf',
  'amountWei',
  'minVolume',
  'maxVolume',
  'minVolumeTarget',
  'maxVolumeTarget',
  'exchangeRate',
  'rate',
  'fees',
  'balance',
  'ethBalance',
  'requiredGasEth',
  'value',
  'valueChf',
  'valueEur',
  'total',
  'totalCount',
  'totalShares',
  'totalSupply',
  'percentage',
  'chf',
  'eur',
  'usd',
  // currencies / times / i18n
  'currency',
  'assets',
  'date',
  'created',
  'timestamp',
  'outputDate',
  'registrationDate',
  'confirmedDate',
  'lastUpdated',
  'timeFrame',
  'language',
  'lang',
  // on-chain data (addresses in these values are masked by the WALLET_ADDRESS value regex)
  'txHash',
  'txHashes',
  'from',
  'to',
  'spender',
  'holders',
  'transfer',
  'approval',
  'tokensDeclaredInvalid',
  'userNonce',
  'domain',
  'types',
  'message',
  'priceSteps',
  'historicalBalances',
  'history',
  // pagination
  'limit',
  'offset',
  'first',
  'before',
  'after',
  'pageInfo',
  'endCursor',
  'startCursor',
  'hasNextPage',
  'hasPreviousPage',
  // nested containers (their own properties are checked individually)
  'kycData',
  'userData',
  'eip7702',
  'beneficiary',
  'addressTypeUpdate',
  // DFX's own recipient payment data
  'paymentRequest',
  'remittanceInfo',
]);

const DTO_CLASSES: Array<new () => object> = [
  ...[realunitDto, realunitSellDto, realunitRegistrationDto, realunitAdminDto, realunitPdfDto].flatMap((module) =>
    Object.values(module).filter(
      (value): value is new () => object => typeof value === 'function' && !!value.prototype,
    ),
  ),
  KycPersonalData,
  KycAddress,
];

function propertiesOf(cls: new () => object): string[] {
  const props: string[] = Reflect.getMetadata('swagger/apiModelPropertiesArray', cls.prototype) ?? [];
  return props.map((p) => p.slice(1));
}

describe('api-trace REDACT_KEY coverage of RealUnit DTOs', () => {
  it('reflects a meaningful number of DTO classes (guard against silent metadata changes)', () => {
    const withProps = DTO_CLASSES.filter((cls) => propertiesOf(cls).length > 0);
    expect(withProps.length).toBeGreaterThanOrEqual(25);
  });

  it('every DTO property is either redacted by key or explicitly known-safe', () => {
    const unaccounted = DTO_CLASSES.flatMap((cls) =>
      propertiesOf(cls)
        .filter((prop) => !REDACT_KEY.test(prop) && !SAFE_KEYS.has(prop))
        .map((prop) => `${cls.name}.${prop}`),
    );
    expect(unaccounted).toEqual([]);
  });
});
