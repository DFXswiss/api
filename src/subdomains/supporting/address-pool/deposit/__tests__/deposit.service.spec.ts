import { createMock } from '@golevelup/ts-jest';
import { AlchemyWebhookService } from 'src/integration/alchemy/services/alchemy-webhook.service';
import { BitcoinService } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { FiroService } from 'src/integration/blockchain/firo/services/firo.service';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { TatumWebhookService } from 'src/integration/tatum/services/tatum-webhook.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DepositRepository } from '../deposit.repository';
import { DepositService } from '../deposit.service';

describe('DepositService', () => {
  let service: DepositService;
  let depositRepo: jest.Mocked<Partial<DepositRepository>>;

  beforeEach(() => {
    depositRepo = { findOneBy: jest.fn() };

    service = new DepositService(
      depositRepo as unknown as DepositRepository,
      createMock<AlchemyWebhookService>(),
      createMock<TatumWebhookService>(),
      createMock<BitcoinService>(),
      createMock<LightningService>(),
      createMock<FiroService>(),
      createMock<MoneroService>(),
    );
  });

  describe('getDepositByAddress', () => {
    // Without an address the only precise condition is dropped and the blockchain LIKE matches on its
    // own, returning an arbitrary deposit on that chain. GsEvmService uses the returned accountIndex
    // to sign and broadcast a transaction, so the wrong row means signing from the wrong account.
    it.each([undefined, null, ''])('does not query when the address is %p', async (address) => {
      const deposit = await service.getDepositByAddress(
        BlockchainAddress.create(address as string, Blockchain.ETHEREUM),
      );

      expect(deposit).toBeUndefined();
      expect(depositRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('still queries when an address is supplied', async () => {
      depositRepo.findOneBy.mockResolvedValue(undefined);

      await service.getDepositByAddress(BlockchainAddress.create('0xabc', Blockchain.ETHEREUM));

      expect(depositRepo.findOneBy).toHaveBeenCalledWith(expect.objectContaining({ address: '0xabc' }));
    });
  });
});
