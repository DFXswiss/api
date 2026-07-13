import { createMock } from '@golevelup/ts-jest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
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
  let stakingService: jest.Mocked<StakingService>;

  beforeEach(() => {
    transactionService = createMock<TransactionService>();
    stakingService = createMock<StakingService>();
    service = new HistoryService(
      createMock<BuyCryptoWebhookService>(),
      createMock<BuyFiatService>(),
      stakingService,
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

  it('routes an ORGANIZATION account to account-scoped history without the organization relation loaded', async () => {
    const account = Object.assign(new UserData(), { id: 5, accountType: AccountType.ORGANIZATION, users: [] });
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

  it('getStakingTransactions maps the account users to userIds for the staking lookup', async () => {
    const account = Object.assign(new UserData(), { id: 5, users: [{ id: 9 }, { id: 11 }] });
    transactionService.getTransactionsForAccount.mockResolvedValue([]);
    stakingService.getUserInvests.mockResolvedValue({ deposits: [], withdrawals: [] });
    stakingService.getUserStakingRewards.mockResolvedValue([]);
    stakingService.getUserStakingRefRewards.mockResolvedValue([]);

    await service.getHistoryForSubject(account, { format: ExportFormat.JSON, staking: true }, ExportType.COMPACT);

    expect(stakingService.getUserInvests).toHaveBeenCalledWith([9, 11], undefined, undefined);
    expect(stakingService.getUserStakingRewards).toHaveBeenCalledWith([9, 11], undefined, undefined);
    expect(stakingService.getUserStakingRefRewards).toHaveBeenCalledWith([9, 11], undefined, undefined);
  });

  it('fails loud when the users relation of an account subject is not loaded', async () => {
    // every path reaching this code loads `users`; if one ever stops doing so, the staking history
    // must not be silently dropped from the export
    const account = Object.assign(new UserData(), { id: 5 });
    transactionService.getTransactionsForAccount.mockResolvedValue([]);

    await expect(
      service.getHistoryForSubject(account, { format: ExportFormat.JSON, staking: true }, ExportType.COMPACT),
    ).rejects.toThrow(TypeError);
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
