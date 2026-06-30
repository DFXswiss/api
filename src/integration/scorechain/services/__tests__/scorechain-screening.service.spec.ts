import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  ScorechainAnalysisType,
  ScorechainBlockchain,
  ScorechainObjectType,
  toScorechainBlockchain,
} from '../../dto/scorechain.dto';
import { ScorechainScreening } from '../../entities/scorechain-screening.entity';
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
      scorechain.scoringAnalysis.mockResolvedValue({ data: { score: 12, severity: 'low' }, signatureValid: true });

      const result = await service.screenWithdrawalAddress(Blockchain.ETHEREUM, '0xabc');

      expect(scorechain.scoringAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          objectType: ScorechainObjectType.ADDRESS,
          analysisType: ScorechainAnalysisType.OUTGOING,
          blockchain: ScorechainBlockchain.ETHEREUM,
          objectId: '0xabc',
        }),
      );
      expect(result.riskScore).toBe(12);
      expect(service.isHighRisk(result)).toBe(false);
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
  });

  describe('isHighRisk (fail-closed)', () => {
    const make = (p: Partial<ScorechainScreening>) => Object.assign(new ScorechainScreening(), p);

    it('flags an invalid signature', () => {
      expect(service.isHighRisk(make({ signatureValid: false, riskScore: 0 }))).toBe(true);
    });

    it('flags a missing score', () => {
      expect(service.isHighRisk(make({ signatureValid: true }))).toBe(true);
    });

    it('passes a valid low score', () => {
      expect(service.isHighRisk(make({ signatureValid: true, riskScore: 1 }))).toBe(false);
    });
  });
});
