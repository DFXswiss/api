import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Deposit } from 'src/subdomains/supporting/address-pool/deposit/deposit.entity';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkStatus } from '../enums';

const defaultUserData: Partial<UserData> = {
  id: 1,
  paymentLinksName: 'TestLinkName',
};

const defaultUser: Partial<User> = {
  id: 1,
  userData: Object.assign(new UserData(), defaultUserData),
};

const defaultFiat: Partial<Fiat> = {
  id: 1,
  name: 'CHF',
};

const defaultDeposit: Partial<Deposit> = {
  address: 'LNURL1DP68GURN8GHJ7AR9WD6ZUERX0QHXZURF8GCNYVE5X5HHVVPWXYHKCMN4WFK8QTMCX9VNY73N9J6F46',
};

const defaultRoute: Partial<Sell> = {
  id: 1,
  user: Object.assign(new User(), defaultUser),
  fiat: Object.assign(new Fiat(), defaultFiat),
  deposit: Object.assign(new Deposit(), defaultDeposit),
};

const defaultPaymentLink: Partial<PaymentLink> = {
  id: 1,
  status: PaymentLinkStatus.ACTIVE,
  uniqueId: 'pl_12345',
  externalId: 'cash-register-001',
  route: Object.assign(new Sell(), defaultRoute),
};

export function createDefaultPaymentLink(): PaymentLink {
  return createCustomPaymentLink({});
}

export function createCustomPaymentLink(customValues: Partial<PaymentLink>): PaymentLink {
  return Object.assign(new PaymentLink(), { ...defaultPaymentLink, payments: [], ...customValues });
}
