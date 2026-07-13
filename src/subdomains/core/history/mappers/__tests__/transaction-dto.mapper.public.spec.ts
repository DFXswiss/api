import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  TransactionDto,
  TransactionReason,
  TransactionState,
  TransactionType,
  UnassignedTransactionDto,
} from 'src/subdomains/supporting/payment/dto/transaction.dto';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { TransactionDtoMapper } from '../transaction-dto.mapper';

describe('TransactionDtoMapper.toPublicDto', () => {
  it('strips private fields from a full TransactionDto', () => {
    const full = Object.assign(new TransactionDto(), {
      id: 42,
      uid: 'Tabcdefghijklmnop',
      orderUid: 'Qxyz',
      type: TransactionType.BUY,
      state: TransactionState.COMPLETED,
      reason: undefined,
      inputAmount: 100,
      inputAsset: 'EUR',
      inputAssetId: 1,
      inputPaymentMethod: FiatPaymentMethod.BANK,
      outputAmount: 0.01,
      outputAsset: 'BTC',
      outputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      outputTxUrl: 'https://explorer/tx/1',
      depositAddress: 'bc1qsecret',
      chargebackTarget: 'CH9300762011623852957',
      chargebackAmount: 50,
      chargebackAsset: 'EUR',
      chargebackTxId: 'remittance-secret',
      chargebackTxUrl: 'https://explorer/chargeback/secret',
      fees: { total: 1, dfx: 0.5, rate: 0.01 },
      feeAmount: 1,
      feeAsset: 'EUR',
      priceSteps: [PriceStep.create('Kraken', 'EUR', 'BTC', 0.00001)],
      externalTransactionId: 'partner-secret',
      networkStartTx: { txId: 'n1', txUrl: 'u', amount: 1, exchangeRate: 1, asset: 'ETH' },
      exchangeRate: 10000,
      date: new Date('2024-01-01'),
    } as unknown as TransactionDto);

    const pub = TransactionDtoMapper.toPublicDto(full) as TransactionDto;

    expect(pub.uid).toBe(full.uid);
    expect(pub.id).toBe(42);
    expect(pub.state).toBe(TransactionState.COMPLETED);
    expect(pub.inputAmount).toBe(100);
    expect(pub.outputAmount).toBe(0.01);
    expect(pub.exchangeRate).toBe(10000);
    expect(pub.outputTxUrl).toBe('https://explorer/tx/1');
    expect(pub.chargebackAmount).toBe(50);

    // stripped
    expect(pub.chargebackTarget).toBeUndefined();
    expect(pub.depositAddress).toBeUndefined();
    expect(pub.chargebackTxId).toBeUndefined();
    expect(pub.chargebackTxUrl).toBeUndefined();
    expect(pub.fees).toBeUndefined();
    expect(pub.feeAmount).toBeUndefined();
    expect(pub.priceSteps).toBeUndefined();
    expect(pub.externalTransactionId).toBeUndefined();
    expect(pub.networkStartTx).toBeUndefined();
  });

  it('strips IBAN from UnassignedTransactionDto chargebackTarget', () => {
    const unassigned = Object.assign(new UnassignedTransactionDto(), {
      uid: 'Tzzzzzzzzzzzzzzzz',
      type: TransactionType.BUY,
      state: TransactionState.UNASSIGNED,
      inputAmount: 10,
      inputAsset: 'CHF',
      chargebackTarget: 'DE89370400440532013000',
      chargebackAmount: 10,
      date: new Date(),
    } as UnassignedTransactionDto);

    const pub = TransactionDtoMapper.toPublicDto(unassigned);

    expect(pub.uid).toBe(unassigned.uid);
    expect(pub.chargebackTarget).toBeUndefined();
    expect(pub.chargebackAmount).toBe(10);
    expect(pub).toBeInstanceOf(UnassignedTransactionDto);
  });

  it('does not mutate the original dto', () => {
    const full = Object.assign(new TransactionDto(), {
      uid: 'Tabcdefghijklmnop',
      type: TransactionType.SELL,
      state: TransactionState.PROCESSING,
      chargebackTarget: 'CH9300762011623852957',
      fees: { total: 2 },
      date: new Date(),
    } as TransactionDto);

    TransactionDtoMapper.toPublicDto(full);

    expect(full.chargebackTarget).toBe('CH9300762011623852957');
    expect(full.fees).toEqual({ total: 2 });
  });

  it('strips a fiat output transaction identifier', () => {
    const full = Object.assign(new TransactionDto(), {
      uid: 'Tselloutputref',
      type: TransactionType.SELL,
      state: TransactionState.COMPLETED,
      reason: undefined,
      outputPaymentMethod: FiatPaymentMethod.BANK,
      outputTxId: 'DFX Payout 4711',
      outputTxUrl: 'https://bank/ref-4711',
      date: new Date('2024-01-01'),
    } as TransactionDto);

    const pub = TransactionDtoMapper.toPublicDto(full) as TransactionDto;

    expect(pub.outputTxId).toBeUndefined();
    expect(pub.outputTxUrl).toBeUndefined();
  });

  it('preserves a crypto output transaction identifier and URL', () => {
    const full = Object.assign(new TransactionDto(), {
      uid: 'Tbuyoutputtxid',
      type: TransactionType.BUY,
      state: TransactionState.COMPLETED,
      reason: undefined,
      outputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      outputTxId: '0xabc',
      outputTxUrl: 'https://explorer/tx/0xabc',
      date: new Date('2024-01-01'),
    } as TransactionDto);

    const pub = TransactionDtoMapper.toPublicDto(full) as TransactionDto;

    expect(pub.outputTxId).toBe('0xabc');
    expect(pub.outputTxUrl).toBe('https://explorer/tx/0xabc');
  });

  it('preserves only crypto input transaction identifiers', () => {
    const cryptoInput = Object.assign(new TransactionDto(), {
      uid: 'Tcryptoinputid',
      type: TransactionType.SELL,
      state: TransactionState.PROCESSING,
      reason: undefined,
      inputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      inputTxId: '0xdef',
      inputTxUrl: 'https://explorer/tx/0xdef',
      date: new Date('2024-01-01'),
    } as TransactionDto);
    const fiatInput = Object.assign(new TransactionDto(), {
      uid: 'Tfiatinputref',
      type: TransactionType.BUY,
      state: TransactionState.PROCESSING,
      reason: undefined,
      inputPaymentMethod: FiatPaymentMethod.BANK,
      inputTxId: 'some-bank-ref',
      inputTxUrl: 'https://bank/in-ref',
      date: new Date('2024-01-01'),
    } as TransactionDto);

    const publicCryptoInput = TransactionDtoMapper.toPublicDto(cryptoInput) as TransactionDto;
    const publicFiatInput = TransactionDtoMapper.toPublicDto(fiatInput) as TransactionDto;

    expect(publicCryptoInput.inputTxId).toBe('0xdef');
    expect(publicCryptoInput.inputTxUrl).toBe('https://explorer/tx/0xdef');
    expect(publicFiatInput.inputTxId).toBeUndefined();
    expect(publicFiatInput.inputTxUrl).toBeUndefined();
  });

  it('strips the chargeback identifiers of a crypto input, which would resolve to the chargeback target', () => {
    const full = Object.assign(new TransactionDto(), {
      uid: 'Tchargebackcrypto',
      type: TransactionType.SELL,
      state: TransactionState.FAILED,
      reason: null,
      inputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      chargebackTarget: 'bc1qsecretchargebacktarget',
      chargebackTxId: '0xchargeback',
      chargebackTxUrl: 'https://explorer/tx/0xchargeback',
      chargebackAmount: 25,
      date: new Date('2024-01-01'),
    } as TransactionDto);

    const pub = TransactionDtoMapper.toPublicDto(full) as TransactionDto;

    expect(pub.chargebackTxId).toBeUndefined();
    expect(pub.chargebackTxUrl).toBeUndefined();
    expect(pub.chargebackTarget).toBeUndefined();
    expect(pub.chargebackAmount).toBe(25);
  });

  it('strips the chargeback identifiers of a fiat input', () => {
    const full = Object.assign(new TransactionDto(), {
      uid: 'Tchargebackfiat',
      type: TransactionType.BUY,
      state: TransactionState.FAILED,
      reason: null,
      inputPaymentMethod: FiatPaymentMethod.BANK,
      chargebackTarget: 'CH9300762011623852957',
      chargebackTxId: 'DFX Chargeback 99',
      chargebackTxUrl: 'https://bank/chargeback-99',
      date: new Date('2024-01-01'),
    } as TransactionDto);

    const pub = TransactionDtoMapper.toPublicDto(full) as TransactionDto;

    expect(pub.chargebackTxId).toBeUndefined();
    expect(pub.chargebackTxUrl).toBeUndefined();
    expect(pub.chargebackTarget).toBeUndefined();
  });

  it.each([
    TransactionReason.SANCTION_SUSPICION,
    TransactionReason.FRAUD_SUSPICION,
    TransactionReason.KYC_REJECTED,
    TransactionReason.USER_DELETED,
    // belongs to KycRequiredReason — the whole set stays private so that a visible reason can never
    // re-identify the CheckPending state that toPublicDto masks KycRequired to
    TransactionReason.INSTANT_PAYMENT,
  ])('strips private transaction reason %s', (reason: TransactionReason) => {
    const full = Object.assign(new TransactionDto(), {
      uid: 'Tprivatereason',
      type: TransactionType.BUY,
      state: TransactionState.FAILED,
      reason,
      date: new Date('2024-01-01'),
    } as TransactionDto);

    const pub = TransactionDtoMapper.toPublicDto(full) as TransactionDto;

    expect(pub.reason).toBeUndefined();
  });

  it.each([TransactionReason.MONTHLY_LIMIT_EXCEEDED, TransactionReason.KYC_DATA_NEEDED])(
    'preserves public transaction reason %s',
    (reason: TransactionReason) => {
      const full = Object.assign(new TransactionDto(), {
        uid: 'Tpublicreason',
        type: TransactionType.BUY,
        state: TransactionState.FAILED,
        reason,
        date: new Date('2024-01-01'),
      } as TransactionDto);

      const pub = TransactionDtoMapper.toPublicDto(full) as TransactionDto;

      expect(pub.reason).toBe(reason);
    },
  );

  it.each([TransactionReason.SANCTION_SUSPICION, TransactionReason.FRAUD_SUSPICION, TransactionReason.INSTANT_PAYMENT])(
    'masks the KycRequired state, which only the private reason %s can produce',
    (reason: TransactionReason) => {
      const suspicious = Object.assign(new TransactionDto(), {
        uid: 'Tkycrequired',
        type: TransactionType.BUY,
        state: TransactionState.KYC_REQUIRED,
        reason,
        date: new Date('2024-01-01'),
      } as TransactionDto);
      const manualCheck = Object.assign(new TransactionDto(), {
        uid: 'Tcheckpending',
        type: TransactionType.BUY,
        state: TransactionState.CHECK_PENDING,
        reason: null,
        date: new Date('2024-01-01'),
      } as TransactionDto);

      const pubSuspicious = TransactionDtoMapper.toPublicDto(suspicious) as TransactionDto;
      const pubManualCheck = TransactionDtoMapper.toPublicDto(manualCheck) as TransactionDto;

      // a suspicion must be indistinguishable from an ordinary pending manual check
      expect(pubSuspicious.state).toBe(TransactionState.CHECK_PENDING);
      expect(pubSuspicious.reason).toBeUndefined();
      expect(pubSuspicious.state).toBe(pubManualCheck.state);
      expect(pubSuspicious.reason).toBe(pubManualCheck.reason);
    },
  );

  it('leaves any other state untouched', () => {
    const full = Object.assign(new TransactionDto(), {
      uid: 'Tlimitexceeded',
      type: TransactionType.BUY,
      state: TransactionState.LIMIT_EXCEEDED,
      reason: TransactionReason.MONTHLY_LIMIT_EXCEEDED,
      date: new Date('2024-01-01'),
    } as TransactionDto);

    const pub = TransactionDtoMapper.toPublicDto(full) as TransactionDto;

    expect(pub.state).toBe(TransactionState.LIMIT_EXCEEDED);
    expect(pub.reason).toBe(TransactionReason.MONTHLY_LIMIT_EXCEEDED);
  });

  it('normalises a null transaction reason to undefined', () => {
    // the production mappers set `reason: null` (not undefined) whenever there is no failure reason
    const full = Object.assign(new TransactionDto(), {
      uid: 'Tnullreason',
      type: TransactionType.BUY,
      state: TransactionState.PROCESSING,
      reason: null,
      date: new Date('2024-01-01'),
    } as TransactionDto);

    const pub = TransactionDtoMapper.toPublicDto(full) as TransactionDto;

    expect(pub.reason).toBeUndefined();
  });
});
