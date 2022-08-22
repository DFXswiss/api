import { createDefaultUser } from 'src/user/models/user/__tests__/mock/user.entity.mock';
import { Staking } from '../../staking.entity';

const defaultStaking: Partial<Staking> = {
  user: createDefaultUser(),
  rewards: [],
};

export function createDefaultStaking(): Staking {
  return createCustomStaking({});
}

export function createCustomStaking(customValues: Partial<Staking>): Staking {
  return Object.assign(new Staking(), { ...defaultStaking, ...customValues });
}
