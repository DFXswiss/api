import {
  TransactionDto,
  TransactionState,
  TransactionType,
  UnassignedTransactionDto,
} from 'src/subdomains/supporting/payment/dto/transaction.dto';
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
      inputPaymentMethod: 'Bank',
      outputAmount: 0.01,
      outputAsset: 'BTC',
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
      priceSteps: [{ source: 'a', target: 'b', price: 1 }] as any,
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
});
