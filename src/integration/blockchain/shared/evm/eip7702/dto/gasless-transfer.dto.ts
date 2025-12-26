export interface GaslessTransferRequest {
  userAddress: string;
  tokenAddress: string;
  amount: string; // in wei
  recipient: string;
  deadline: number; // unix timestamp
  signature: {
    v: number;
    r: string;
    s: string;
  };
}

export interface GaslessTransferPrepareRequest {
  userAddress: string;
  tokenAddress: string;
  amount: string; // in wei
  recipient: string;
  deadlineMinutes?: number; // default: 60
}

export interface GaslessTransferPrepareResponse {
  nonce: number;
  deadline: number;
  delegationContract: string;
  eip712Data: Eip712TypedData;
}

export interface Eip712TypedData {
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    Transfer: Array<{ name: string; type: string }>;
  };
  primaryType: string;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  message: {
    token: string;
    amount: string;
    recipient: string;
    nonce: number;
    deadline: number;
  };
}

export interface GaslessTransferResult {
  success: boolean;
  txHash?: string;
  error?: string;
}
