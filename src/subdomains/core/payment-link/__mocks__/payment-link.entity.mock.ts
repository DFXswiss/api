import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { PaymentLink } from '../entities/payment-link.entity';

const defaultUserData: Partial<UserData> = {
  paymentLinksName: 'TestLinkName',
};

const defaultUser: Partial<User> = {
  userData: Object.assign(new UserData(), defaultUserData),
};

const defaultRoute: Partial<Sell> = {
  user: Object.assign(new User(), defaultUser),
};

const defaultPaymentLink: Partial<PaymentLink> = {
  uniqueId: 'pl_12345',
  externalId: 'cash-register-001',
  route: Object.assign(new Sell(), defaultRoute),
};

export function createDefaultPaymentLink(): PaymentLink {
  return createCustomPaymentLink({});
}

export function createCustomPaymentLink(customValues: Partial<PaymentLink>): PaymentLink {
  return Object.assign(new PaymentLink(), { ...defaultPaymentLink, ...customValues });
}
