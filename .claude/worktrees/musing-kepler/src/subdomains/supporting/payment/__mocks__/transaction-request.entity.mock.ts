import { createDefaultUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { TransactionRequest, TransactionRequestType } from '../entities/transaction-request.entity';

const defaultTransactionRequest: Partial<TransactionRequest> = {
  id: 1,
  type: TransactionRequestType.BUY,
  uid: 'Q186C06388387A6FD',
  user: createDefaultUser(),
};

export function createDefaultTransactionRequest(): TransactionRequest {
  return createCustomTransactionRequest({});
}

export function createCustomTransactionRequest(customValues: Partial<TransactionRequest>): TransactionRequest {
  return Object.assign(new TransactionRequest(), { ...defaultTransactionRequest, ...customValues });
}
