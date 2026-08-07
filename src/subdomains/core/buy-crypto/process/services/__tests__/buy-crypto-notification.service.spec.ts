import { mock } from 'jest-mock-extended';
import { ErrorMonitoringMailInput } from 'src/subdomains/supporting/notification/entities/mail/error-monitoring-mail';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
// out of alphabetical order on purpose: the entity and the mail factory import each other, and loading the
// entity first leaves `class Mail extends Notification` with an undefined base class. The service pulls the
// factory in first, which is the order the application itself loads them in
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Notification } from 'src/subdomains/supporting/notification/entities/notification.entity';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from '../buy-crypto-notification.service';

/**
 * The debounce that decides how often a missing-liquidity report reaches a human is keyed on the correlation
 * id: `NotificationService.isSuppressed` looks up the last notification with the same id and context, and
 * `Notification.isSuppressed` drops the new one while that one is inside its debounce window. The id therefore
 * has to name the asset whose liquidity is unmet - the thing being reported - and nothing that changes while
 * it stays unmet, or every change starts a new window and the window means nothing.
 */
describe('BuyCryptoNotificationService', () => {
  let service: BuyCryptoNotificationService;
  let notificationService: NotificationService;

  beforeEach(() => {
    notificationService = mock<NotificationService>();
    service = new BuyCryptoNotificationService(mock<BuyCryptoRepository>(), notificationService);
  });

  describe('#sendMissingLiquidityError(...)', () => {
    function sentRequests(): MailRequest[] {
      return (notificationService.sendMail as jest.Mock).mock.calls.map(([request]) => request as MailRequest);
    }

    // the real evaluator, so the assertion is about suppression and not about two strings being equal
    function sentNotifications(): Notification[] {
      return sentRequests().map((request) =>
        Object.assign(new Notification(), NotificationService.fromRequest(request)),
      );
    }

    it('reports one asset under one correlation id, whatever the waiting set is', async () => {
      await service.sendMissingLiquidityError('ETH', 'Ethereum', 'Coin', [11, 12], ['first']);
      await service.sendMissingLiquidityError('ETH', 'Ethereum', 'Coin', [11, 12, 13], ['second']);

      const [first, second] = sentRequests();
      expect(first.correlationId).toBe('BuyCryptoBatch&LiquidityCheck&ETH&Ethereum&Coin');
      expect(second.correlationId).toBe(first.correlationId);
    });

    it('debounces the next report of the same asset once one transaction has joined the waiting set', async () => {
      await service.sendMissingLiquidityError('ETH', 'Ethereum', 'Coin', [11, 12], ['first']);
      await service.sendMissingLiquidityError('ETH', 'Ethereum', 'Coin', [11, 12, 13], ['second']);

      const [first, second] = sentNotifications();
      expect(second.isSuppressed(first)).toBe(true);
    });

    it('does not debounce another asset against the one already reported', async () => {
      await service.sendMissingLiquidityError('ETH', 'Ethereum', 'Coin', [11], ['first']);
      await service.sendMissingLiquidityError('USDT', 'Ethereum', 'Token', [11], ['second']);

      const [first, second] = sentNotifications();
      expect(second.isSuppressed(first)).toBe(false);
    });

    it('names the transactions the report is about in the mail body', async () => {
      await service.sendMissingLiquidityError('ETH', 'Ethereum', 'Coin', [11, 12], ['Liquidity order failed']);

      const [request] = sentRequests();
      expect((request.input as ErrorMonitoringMailInput).errors).toEqual([
        'Liquidity order failed',
        'Transaction ID(s): 11,12',
      ]);
    });
  });
});
