import { UserData } from '../user-data.entity';

describe('UserData', () => {
  const accountWith = (feeIds: number[]) => Object.assign(new UserData(), { id: 7, individualFees: feeIds.join(';') });

  describe('individualFeeList', () => {
    it('reports no fees for an account whose list was emptied', () => {
      // An emptied list is stored as '', which naive splitting turns into the fee id 0.
      expect(accountWith([]).individualFeeList).toBeUndefined();
    });

    it('reports the assigned fees', () => {
      expect(accountWith([55, 70]).individualFeeList).toEqual([55, 70]);
    });
  });

  describe('replaceFee', () => {
    it('swaps the named fees for the new one', () => {
      const userData = accountWith([60]);

      const [id, update] = userData.replaceFee([60], 70);

      expect(id).toBe(7);
      expect(update.individualFees).toBe('70');
      expect(userData.individualFeeList).toEqual([70]);
    });

    it('keeps fees that are not part of the replaced set', () => {
      const userData = accountWith([55, 60, 92]);

      userData.replaceFee([60], 70);

      // 55 and 92 were assigned by other flows (sign-up fees, discount codes) and must survive.
      expect(userData.individualFeeList).toEqual([55, 92, 70]);
    });

    it('drops the named fees when no replacement is given', () => {
      const userData = accountWith([55, 60]);

      const [, update] = userData.replaceFee([60]);

      expect(update.individualFees).toBe('55');
    });

    it('assigns a fee to an account that has none', () => {
      const userData = accountWith([]);

      const [, update] = userData.replaceFee([], 70);

      expect(update.individualFees).toBe('70');
    });

    it('leaves no fees behind when everything is replaced by nothing', () => {
      const userData = accountWith([60]);

      const [, update] = userData.replaceFee([60]);

      expect(update.individualFees).toBe('');
    });

    // Two operators setting an amount at the same time load their own copy of the account. Whatever
    // the interleaving, the account must never end up carrying two onboarding fees - their fixed
    // amounts would be summed into a single charge.
    it.each([
      ['first write wins the read, second overwrites', [0, 1]],
      ['second write lands first', [1, 0]],
    ])('never leaves two onboarding fees behind when writes interleave (%s)', (_name, order) => {
      const stored = { individualFees: '60' };
      const copies = [accountWith([60]), accountWith([60])];
      const writes = [
        () => (stored.individualFees = copies[0].replaceFee([60], 70)[1].individualFees),
        () => (stored.individualFees = copies[1].replaceFee([60], 130)[1].individualFees),
      ];

      order.forEach((i) => writes[i]());

      expect(stored.individualFees.split(';').filter(Boolean)).toHaveLength(1);
      expect(['70', '130']).toContain(stored.individualFees);
    });
  });
});
