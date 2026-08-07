export interface AlchemyWebhookDto {
  webhookId: string;
  id: string;
  createdAt: string;
  type: string;
  event: {
    network: string;
    activity: AlchemyWebhookActivityDto[];
  };
}

export interface AlchemyWebhookActivityDto {
  fromAddress: string;
  toAddress: string;
  blockNum: string;
  hash: string;
  value: number;
  asset: string;
  category: string;
  erc721TokenId?: string;
  erc1155Metadata?: { tokenId: string; value: string }[];
  rawContract: {
    rawValue: string;
    decimals: number;
    address: string;
  };
}
