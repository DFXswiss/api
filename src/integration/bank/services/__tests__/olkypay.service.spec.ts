import { createMock } from '@golevelup/ts-jest';
import { HttpService } from 'src/shared/services/http.service';
import { OlkyRecipient } from '../../entities/olky-recipient.entity';
import { OlkyRecipientRepository } from '../../repositories/olky-recipient.repository';
import { OlkypayService } from '../olkypay.service';

describe('OlkypayService', () => {
  let service: OlkypayService;
  let recipientRepo: OlkyRecipientRepository;

  beforeEach(() => {
    recipientRepo = createMock<OlkyRecipientRepository>();
    service = new OlkypayService(createMock<HttpService>(), recipientRepo);
  });

  describe('getOrCreateRecipient', () => {
    it('rejects a zip code longer than 8 characters', async () => {
      await expect(
        service.getOrCreateRecipient({
          iban: 'DE89370400440532013000',
          name: 'John Doe',
          zip: '97283 Riedenheim',
          city: '97283 Riedenheim',
        }),
      ).rejects.toThrow(/zip code/i);

      expect(recipientRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('accepts a valid zip code', async () => {
      jest
        .spyOn(recipientRepo, 'findOneBy')
        .mockResolvedValue({ id: 1, olkyPayerId: '1', olkyBankAccountId: '2' } as OlkyRecipient);

      const result = await service.getOrCreateRecipient({
        iban: 'DE89370400440532013000',
        name: 'John Doe',
        zip: '97283',
        city: 'Riedenheim',
      });

      expect(result).toBeDefined();
      expect(recipientRepo.findOneBy).toHaveBeenCalled();
    });
  });
});
