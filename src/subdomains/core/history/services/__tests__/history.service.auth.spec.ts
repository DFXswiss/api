import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createMock } from '@golevelup/ts-jest';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { BuyCryptoWebhookService } from '../../../buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyFiatService } from '../../../sell-crypto/process/services/buy-fiat.service';
import { StakingService } from '../../../staking/services/staking.service';
import { ExportFormat } from '../../dto/history-query.dto';
import { ExportType, HistoryService } from '../history.service';

describe('HistoryService auth-facing methods', () => {
  let service: HistoryService;
  let transactionService: jest.Mocked<TransactionService>;

  beforeEach(() => {
    transactionService = createMock<TransactionService>();
    service = new HistoryService(
      createMock<BuyCryptoWebhookService>(),
      createMock<BuyFiatService>(),
      createMock<StakingService>(),
      transactionService,
    );
  });

  it('getHistoryForSubject rejects missing subject', async () => {
    await expect(
      service.getHistoryForSubject(undefined as unknown as User, { format: ExportFormat.JSON }, ExportType.COMPACT),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getHistoryForSubject uses account transactions for UserData', async () => {
    const account = Object.assign(new UserData(), { id: 5, users: [] });
    transactionService.getTransactionsForAccount.mockResolvedValue([]);

    const result = await service.getHistoryForSubject(account, { format: ExportFormat.JSON }, ExportType.COMPACT);

    expect(transactionService.getTransactionsForAccount).toHaveBeenCalledWith(
      5,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual([]);
  });

  it('getJsonHistory uses user transactions for User', async () => {
    const user = Object.assign(new User(), { id: 9, address: '0x1' });
    transactionService.getTransactionsForUsers.mockResolvedValue([]);

    const result = await service.getJsonHistory(user, { format: ExportFormat.JSON }, ExportType.COMPACT);

    expect(transactionService.getTransactionsForUsers).toHaveBeenCalledWith(
      [9],
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual([]);
  });

  it('getHistory always throws UnauthorizedException', async () => {
    await expect(service.getHistory({}, ExportType.COMPACT)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.getHistory({ userAddress: '0x1' }, ExportType.COMPACT)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('getCsvHistory always throws UnauthorizedException', async () => {
    await expect(service.getCsvHistory({ userAddress: '0x1' }, ExportType.COMPACT)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
