export class BlockchainTransaction {
  blk_id: number;
  value: number;
  tx_id: string;
  dt: string;
  cat: string;
  tokens: [
    {
      code: string;
      qty: number;
      value?: number;
    },
  ];
}
