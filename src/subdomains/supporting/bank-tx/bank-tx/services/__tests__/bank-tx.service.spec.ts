import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { createCustomBankTx } from '../../__mocks__/bank-tx.entity.mock';
import { BankTxIndicator, BankTxType } from '../../entities/bank-tx.entity';
import { BankTxRepository } from '../../repositories/bank-tx.repository';
import { BankTxService } from '../bank-tx.service';

describe('BankTxService.fillBankTx', () => {
  let service: BankTxService;
  let bankTxRepo: jest.Mocked<BankTxRepository>;

  beforeEach(async () => {
    bankTxRepo = createMock<BankTxRepository>();

    const module: TestingModule = await Test.createTestingModule({ providers: [BankTxService] })
      .useMocker((token) => (token === BankTxRepository ? bankTxRepo : createMock()))
      .compile();
    service = module.get(BankTxService);
  });

  it('does NOT add the charge back on top of a DEBIT (outgoing, Bank Frick payout) row - amount is already gross/charge-inclusive, matching the #8 matcher convention', async () => {
    // The literal NEW-3 regression case: before this fix, `entity.amount + entity.chargeAmount` was used
    // unconditionally, so a charged DEBIT row (amount=1005, chargeAmount=5) computed
    // accountingAmountBeforeFee=1010 - overbooked, and inconsistent with BankTxOutgoingMatchService's
    // matcher, which already treats `amount` as gross for DEBIT and subtracts chargeAmount to match.
    const debitTx = createCustomBankTx({
      id: 1,
      type: BankTxType.BUY_FIAT,
      creditDebitIndicator: BankTxIndicator.DEBIT,
      amount: 1005,
      chargeAmount: 5,
      buyFiats: [{ percentFee: 0.01, amountInChf: 995 } as never],
    });
    bankTxRepo.find.mockResolvedValue([debitTx]);

    await service['fillBankTx']();

    expect(bankTxRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ accountingAmountBeforeFee: 1005 }));
  });

  it('still adds the charge back on top of a CREDIT (incoming customer deposit) row - amount arrives charge-exclusive and chargeAmount must be recovered (unchanged from before this PR)', async () => {
    const creditTx = createCustomBankTx({
      id: 2,
      type: BankTxType.BANK_TX_REPEAT,
      creditDebitIndicator: BankTxIndicator.CREDIT,
      amount: 1000,
      chargeAmount: 5,
    });
    bankTxRepo.find.mockResolvedValue([creditTx]);

    await service['fillBankTx']();

    expect(bankTxRepo.update).toHaveBeenCalledWith(2, { accountingAmountBeforeFee: 1005 });
  });

  it('treats a DEBIT BUY_CRYPTO row the same way - no charge added back on top', async () => {
    const debitTx = createCustomBankTx({
      id: 3,
      type: BankTxType.BUY_CRYPTO,
      creditDebitIndicator: BankTxIndicator.DEBIT,
      amount: 1005,
      chargeAmount: 5,
      buyCrypto: { percentFee: 0.01, amountInChf: 995 } as never,
    });
    bankTxRepo.find.mockResolvedValue([debitTx]);

    await service['fillBankTx']();

    expect(bankTxRepo.update).toHaveBeenCalledWith(3, expect.objectContaining({ accountingAmountBeforeFee: 1005 }));
  });
});
