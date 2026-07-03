import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  ScorechainAnalysisType,
  ScorechainBlockchain,
  ScorechainObjectType,
  toScorechainBlockchain,
} from '../../dto/scorechain.dto';
import { ScorechainScreening, ScorechainScreeningContext } from '../../entities/scorechain-screening.entity';
import { ScorechainObjectNotFoundException } from '../../exceptions/scorechain-object-not-found.exception';
import { ScorechainScreeningRepository } from '../../repositories/scorechain-screening.repository';
import { ScorechainScreeningService } from '../scorechain-screening.service';
import { ScorechainService } from '../scorechain.service';

describe('ScorechainScreeningService', () => {
  let service: ScorechainScreeningService;
  let scorechain: { scoringAnalysis: jest.Mock };
  let repo: {
    findOne: jest.Mock;
    countBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    scorechain = { scoringAnalysis: jest.fn() };
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      countBy: jest.fn().mockResolvedValue(0),
      create: jest.fn((e) => Object.assign(new ScorechainScreening(), e)),
      save: jest.fn((e) => Promise.resolve(e)),
    };
    service = new ScorechainScreeningService(
      scorechain as unknown as ScorechainService,
      repo as unknown as ScorechainScreeningRepository,
    );
  });

  describe('blockchain mapping', () => {
    it('maps a supported DFX chain to the Scorechain id', () => {
      expect(toScorechainBlockchain(Blockchain.ARBITRUM)).toBe(ScorechainBlockchain.ARBITRUMONE);
    });

    it('returns undefined for an unsupported chain', () => {
      expect(toScorechainBlockchain(Blockchain.LIGHTNING)).toBeUndefined();
    });
  });

  describe('screening', () => {
    it('scores a withdrawal address (objectType=ADDRESS, OUTGOING) and persists the result', async () => {
      scorechain.scoringAnalysis.mockResolvedValue({
        data: { id: 'x', lowestScore: 85, analysis: { assigned: { hasResult: true, result: { score: 85 } } } },
        signatureValid: true,
      });

      const result = await service.screenWithdrawalAddress(Blockchain.ETHEREUM, '0xabc');

      expect(scorechain.scoringAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          objectType: ScorechainObjectType.ADDRESS,
          analysisType: ScorechainAnalysisType.OUTGOING,
          blockchain: ScorechainBlockchain.ETHEREUM,
          objectId: '0xabc',
        }),
      );
      expect(result.riskScore).toBe(85);
      expect(service.isHighRisk(result)).toBe(false); // high score = safe
    });

    it('flags a low-scoring (risky) deposit transaction for manual review', async () => {
      scorechain.scoringAnalysis.mockResolvedValue({
        data: { id: 'x', lowestScore: 15, analysis: { incoming: { hasResult: true, result: { score: 15 } } } },
        signatureValid: true,
      });

      const result = await service.screenDepositTransaction(Blockchain.BITCOIN, 'txhash');

      expect(result.riskScore).toBe(15);
      expect(service.isHighRisk(result)).toBe(true); // low score = risky
    });

    it('passes a fresh withdrawal address with no coverage (no data is not a risk signal)', async () => {
      // Scorechain returns lowestScore=100 even when it has no data for the object. For a withdrawal
      // to a fresh destination address, no coverage is the normal case, not a risk signal.
      scorechain.scoringAnalysis.mockResolvedValue({
        data: { id: 'x', lowestScore: 100, analysis: { assigned: { hasResult: false, result: null } } },
        signatureValid: true,
      });

      const result = await service.screenWithdrawalAddress(Blockchain.ETHEREUM, '0xfresh');

      expect(scorechain.scoringAnalysis).toHaveBeenCalled();
      expect(result.riskScore).toBeUndefined();
      expect(result.severity).toBe('NoCoverage');
      expect(service.isHighRisk(result)).toBe(false);
    });

    it('flags a no-coverage deposit transaction (fail-closed — an unanalysable incoming tx)', async () => {
      scorechain.scoringAnalysis.mockResolvedValue({
        data: { id: 'x', lowestScore: 100, analysis: { incoming: { hasResult: false, result: null } } },
        signatureValid: true,
      });

      const result = await service.screenDepositTransaction(Blockchain.ETHEREUM, 'txhash');

      expect(result.severity).toBe('NoCoverage');
      expect(service.isHighRisk(result)).toBe(true);
    });

    it('skips an unsupported chain without calling the API and flags it high-risk', async () => {
      const result = await service.screenWithdrawalAddress(Blockchain.LIGHTNING, 'addr');

      expect(scorechain.scoringAnalysis).not.toHaveBeenCalled();
      expect(result.severity).toBe('NotSupported');
      expect(service.isHighRisk(result)).toBe(true);
    });

    it('returns the cached screening without calling the API', async () => {
      const cached = Object.assign(new ScorechainScreening(), { riskScore: 1, signatureValid: true });
      repo.findOne.mockResolvedValue(cached);

      const result = await service.screenWithdrawalAddress(Blockchain.ETHEREUM, '0xabc');

      expect(result).toBe(cached);
      expect(scorechain.scoringAnalysis).not.toHaveBeenCalled();
    });

    it('reuses a TRANSACTION verdict with no time bound (screened at most once) but expires ADDRESS verdicts after a short TTL', async () => {
      scorechain.scoringAnalysis.mockResolvedValue({
        data: {
          id: 'x',
          lowestScore: 80,
          analysis: {
            assigned: { hasResult: true, result: { score: 80 } },
            incoming: { hasResult: true, result: { score: 80 } },
          },
        },
        signatureValid: true,
      });

      await service.screenWithdrawalAddress(Blockchain.ETHEREUM, '0xabc');
      const addressWhere = repo.findOne.mock.calls[0][0].where;

      await service.screenDepositTransaction(Blockchain.ETHEREUM, 'txhash');
      const transactionWhere = repo.findOne.mock.calls[1][0].where;

      // ADDRESS: a created lower bound (short TTL) so a stale clean verdict cannot survive.
      expect(addressWhere.created).toBeDefined();
      // TRANSACTION: NO created bound → any prior verified record is reused regardless of age, so a
      // given tx hash is never re-sent to the provider in regular operation.
      expect(transactionWhere.created).toBeUndefined();
    });

    it('fails closed when the monthly quota is reached', async () => {
      process.env.SCORECHAIN_MONTHLY_CHECK_LIMIT = '5';
      new ConfigService();
      repo.countBy.mockResolvedValue(5);

      await expect(service.screenWithdrawalAddress(Blockchain.ETHEREUM, '0xabc')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      delete process.env.SCORECHAIN_MONTHLY_CHECK_LIMIT;
      new ConfigService();
    });

    it('only serves a cached record whose signature verified', async () => {
      scorechain.scoringAnalysis.mockResolvedValue({
        data: { id: 'x', lowestScore: 80, analysis: { assigned: { hasResult: true, result: { score: 80 } } } },
        signatureValid: true,
      });

      await service.screenWithdrawalAddress(Blockchain.ETHEREUM, '0xabc');

      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ signatureValid: true }) }),
      );
    });

    it('excludes non-billable NotSupported rows from the monthly quota count', async () => {
      process.env.SCORECHAIN_MONTHLY_CHECK_LIMIT = '5';
      new ConfigService();
      scorechain.scoringAnalysis.mockResolvedValue({
        data: { id: 'x', lowestScore: 80, analysis: { assigned: { hasResult: true, result: { score: 80 } } } },
        signatureValid: true,
      });

      await service.screenWithdrawalAddress(Blockchain.ETHEREUM, '0xabc');

      expect(repo.countBy).toHaveBeenCalledWith(expect.objectContaining({ severity: expect.anything() }));

      delete process.env.SCORECHAIN_MONTHLY_CHECK_LIMIT;
      new ConfigService();
    });

    it('records a not-found withdrawal address as a NotFound verdict without throwing, and passes it', async () => {
      scorechain.scoringAnalysis.mockRejectedValue(new ScorechainObjectNotFoundException('/scoringAnalysis'));

      const result = await service.screenWithdrawalAddress(Blockchain.BITCOIN, 'bc1qfresh');

      expect(result.severity).toBe('NotFound');
      expect(result.signatureValid).toBe(false);
      expect(service.isHighRisk(result)).toBe(false);
      expect(repo.save).toHaveBeenCalled();
    });

    it('propagates a non-not-found provider error instead of masking it', async () => {
      scorechain.scoringAnalysis.mockRejectedValue(new ServiceUnavailableException('boom'));

      await expect(service.screenWithdrawalAddress(Blockchain.BITCOIN, 'bc1qfresh')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('excludes non-billable NotFound rows from the monthly quota count', async () => {
      process.env.SCORECHAIN_MONTHLY_CHECK_LIMIT = '5';
      new ConfigService();
      scorechain.scoringAnalysis.mockRejectedValue(new ScorechainObjectNotFoundException('/scoringAnalysis'));

      await service.screenWithdrawalAddress(Blockchain.BITCOIN, 'bc1qfresh');

      const where = repo.countBy.mock.calls[0][0];
      expect(JSON.stringify(where.severity)).toContain('NotSupported');
      expect(JSON.stringify(where.severity)).toContain('NotFound');

      delete process.env.SCORECHAIN_MONTHLY_CHECK_LIMIT;
      new ConfigService();
    });
  });

  describe('isHighRisk (fail-closed)', () => {
    const make = (p: Partial<ScorechainScreening>) => Object.assign(new ScorechainScreening(), p);

    it('flags an invalid signature even with a safe score', () => {
      expect(service.isHighRisk(make({ signatureValid: false, riskScore: 95 }))).toBe(true);
    });

    it('flags a missing score', () => {
      expect(service.isHighRisk(make({ signatureValid: true }))).toBe(true);
    });

    it('flags a low score (risky)', () => {
      expect(service.isHighRisk(make({ signatureValid: true, riskScore: 10 }))).toBe(true);
    });

    it('passes a high score (safe)', () => {
      expect(service.isHighRisk(make({ signatureValid: true, riskScore: 90 }))).toBe(false);
    });

    it('passes a withdrawal to a no-coverage / not-found address (no data is not a risk signal)', () => {
      const w = ScorechainScreeningContext.WITHDRAWAL;
      expect(service.isHighRisk(make({ context: w, signatureValid: true, severity: 'NoCoverage' }))).toBe(false);
      expect(service.isHighRisk(make({ context: w, signatureValid: false, severity: 'NotFound' }))).toBe(false);
    });

    it('fails a withdrawal no-coverage response closed when its signature did not verify', () => {
      const unsigned = make({ context: ScorechainScreeningContext.WITHDRAWAL, signatureValid: false, severity: 'NoCoverage' });
      expect(service.isHighRisk(unsigned)).toBe(true);
    });

    it('still flags a withdrawal with an actual low score', () => {
      const risky = make({ context: ScorechainScreeningContext.WITHDRAWAL, signatureValid: true, riskScore: 40 });
      expect(service.isHighRisk(risky)).toBe(true);
    });

    it('keeps deposits fail-closed on no coverage / not found', () => {
      const d = ScorechainScreeningContext.DEPOSIT;
      expect(service.isHighRisk(make({ context: d, signatureValid: true, severity: 'NoCoverage' }))).toBe(true);
      expect(service.isHighRisk(make({ context: d, signatureValid: false, severity: 'NotFound' }))).toBe(true);
    });
  });
});
