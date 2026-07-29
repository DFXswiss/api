import { ScorechainScreening } from '../scorechain-screening.entity';

describe('ScorechainScreening', () => {
  describe('rawResponseData', () => {
    it('returns undefined when rawResponse is not set', () => {
      const screening = Object.assign(new ScorechainScreening(), {});

      expect(screening.rawResponseData).toBeUndefined();
    });

    it('round-trips an object through the setter and getter', () => {
      const screening = Object.assign(new ScorechainScreening(), {});
      const data = { txHash: '0xabc', score: 12 };

      screening.rawResponseData = data;

      expect(screening.rawResponse).toBe(JSON.stringify(data));
      expect(screening.rawResponseData).toEqual(data);
    });

    it('sets the field to null when the setter receives null', () => {
      const screening = Object.assign(new ScorechainScreening(), { rawResponse: '{"a":1}' });

      screening.rawResponseData = null;

      expect(screening.rawResponse).toBeNull();
      expect(screening.rawResponseData).toBeUndefined();
    });

    it('sets the field to null when the setter receives undefined', () => {
      const screening = Object.assign(new ScorechainScreening(), { rawResponse: '{"a":1}' });

      screening.rawResponseData = undefined;

      expect(screening.rawResponse).toBeNull();
      expect(screening.rawResponseData).toBeUndefined();
    });
  });

  describe('riskIndicatorData', () => {
    it('returns undefined when riskIndicators is not set', () => {
      const screening = Object.assign(new ScorechainScreening(), {});

      expect(screening.riskIndicatorData).toBeUndefined();
    });

    it('round-trips an array through the setter and getter', () => {
      const screening = Object.assign(new ScorechainScreening(), {});
      const data = [{ category: 'sanctions', level: 'high' }];

      screening.riskIndicatorData = data;

      expect(screening.riskIndicators).toBe(JSON.stringify(data));
      expect(screening.riskIndicatorData).toEqual(data);
    });

    it('sets the field to null when the setter receives null', () => {
      const screening = Object.assign(new ScorechainScreening(), { riskIndicators: '[1]' });

      screening.riskIndicatorData = null;

      expect(screening.riskIndicators).toBeNull();
      expect(screening.riskIndicatorData).toBeUndefined();
    });

    it('sets the field to null when the setter receives undefined', () => {
      const screening = Object.assign(new ScorechainScreening(), { riskIndicators: '[1]' });

      screening.riskIndicatorData = undefined;

      expect(screening.riskIndicators).toBeNull();
      expect(screening.riskIndicatorData).toBeUndefined();
    });
  });
});
