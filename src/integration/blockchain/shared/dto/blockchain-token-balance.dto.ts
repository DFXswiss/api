export interface BlockchainTokenBalance {
  owner: string;
  contractAddress: string;
  balance: number;
  unlockedBalance?: number;
}
