import { EntityManager } from 'typeorm';
import { PaymentActivation } from '../../entities/payment-activation.entity';
import { PaymentActivationService } from '../payment-activation.service';
import { PaymentQuoteService } from '../payment-quote.service';

/**
 * The other half of the transaction proof.
 *
 * `payment-link-payment.service.spec.ts` pins that the transitions HAND their effect services the
 * manager they were given. That alone proves nothing about where the statement lands: a service
 * that accepts the argument and then writes through its own repository would pass that test and
 * still commit on its own — which is exactly the half-state the transaction exists to rule out,
 * and the review that asked for this test was right that nothing here ruled it out.
 *
 * So this side asserts the opposite direction: given a manager, the effect goes through THAT
 * manager's repository and never through the injected one. Given none, it goes through the
 * injected one — the paths outside a transition still work.
 */
describe('effects that run inside a caller transaction', () => {
  type RepoMock = { update: jest.Mock; find: jest.Mock; save: jest.Mock };

  let injectedRepo: RepoMock;
  let managerRepo: RepoMock;
  let manager: EntityManager;

  /** The write surfaces both effect services use; `find` answers with one row so `save` runs. */
  function repoMock(): RepoMock {
    return {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([{ cancel: () => ({ id: 1 }) }]),
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  /** Every way a repository is written through, so a test cannot miss one by naming the wrong. */
  function writes(repo: RepoMock): number {
    return repo.update.mock.calls.length + repo.save.mock.calls.length;
  }

  beforeEach(() => {
    injectedRepo = repoMock();
    managerRepo = repoMock();
    manager = { getRepository: jest.fn().mockReturnValue(managerRepo) } as unknown as EntityManager;
  });

  describe('PaymentActivationService.closeAllForPayment', () => {
    function service(): PaymentActivationService {
      // Only the repository and the one collaborator the constructor calls are real; the rest is
      // untouched by the path under test.
      const lightningService = { getDefaultClient: () => undefined } as never;

      const u = undefined as never;

      return new PaymentActivationService(lightningService, injectedRepo as unknown as never, u, u, u, u, u);
    }

    it('writes through the manager it was given, not through its own repository', async () => {
      await service().closeAllForPayment(7, manager);

      expect(manager.getRepository).toHaveBeenCalledWith(PaymentActivation);
      expect(writes(managerRepo)).toEqual(1);
      // The one that would commit on its own.
      expect(writes(injectedRepo)).toEqual(0);
    });

    it('falls back to its own repository when there is no transaction to join', async () => {
      await service().closeAllForPayment(7);

      expect(writes(injectedRepo)).toEqual(1);
      expect(writes(managerRepo)).toEqual(0);
    });

    it('closes exactly the activations of that payment that are still open', async () => {
      // The criteria matter as much as the connection: closing an already closed activation is
      // harmless, closing another payment's is not.
      await service().closeAllForPayment(7, manager);

      const [criteria] = managerRepo.update.mock.calls[0];

      expect(criteria.payment).toEqual({ id: 7 });
      expect(criteria.status).toBeDefined();
    });
  });

  describe('PaymentQuoteService.cancelAllForPayment', () => {
    function service(): PaymentQuoteService {
      const u = undefined as never;

      return new PaymentQuoteService(injectedRepo as unknown as never, u, u, u, u, u, u, u, u, u);
    }

    it('writes through the manager it was given, not through its own repository', async () => {
      await service().cancelAllForPayment(7, manager);

      expect(managerRepo.find).toHaveBeenCalledTimes(1);
      expect(writes(managerRepo)).toEqual(1);
      expect(injectedRepo.find).not.toHaveBeenCalled();
      expect(writes(injectedRepo)).toEqual(0);
    });

    it('falls back to its own repository when there is no transaction to join', async () => {
      await service().cancelAllForPayment(7);

      expect(writes(injectedRepo)).toEqual(1);
      expect(writes(managerRepo)).toEqual(0);
    });
  });
});
