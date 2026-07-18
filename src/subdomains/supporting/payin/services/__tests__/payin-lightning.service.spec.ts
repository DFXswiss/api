import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { PayInLightningService } from '../payin-lightning.service';

describe('PayInLightningService', () => {
  let service: PayInLightningService;
  let lightningService: LightningService;

  beforeEach(async () => {
    lightningService = createMock<LightningService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PayInLightningService, { provide: LightningService, useValue: lightningService }],
    }).compile();

    service = module.get<PayInLightningService>(PayInLightningService);
  });

  it('returns the broadcast result with zero fee when the completion lookup fails', async () => {
    const payIn = createCustomCryptoInput({
      id: 1,
      destinationAddress: BlockchainAddress.create('ln-destination', Blockchain.LIGHTNING),
    });
    const outTxId = 'payment-hash';
    const lookupError = new Error('LND unavailable');
    jest.spyOn(lightningService, 'sendTransfer').mockResolvedValue(outTxId);
    jest.spyOn(lightningService, 'getTransferCompletionData').mockRejectedValue(lookupError);
    const logSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

    await expect(service.sendTransfer(payIn)).resolves.toEqual({ outTxId, feeAmount: 0 });

    expect(logSpy).toHaveBeenCalledWith(
      `Lightning completion lookup failed after broadcast (tx ${outTxId}) for pay-in ${payIn.id}:`,
      lookupError,
    );
  });
});
