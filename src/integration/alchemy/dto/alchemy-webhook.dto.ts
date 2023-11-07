export interface AlchemyWebhookDto {
  webhookId: string;
  id: string;
  createdAt: string;
  type: string;
  event: {
    network: string;
    activity: [
      {
        fromAddress: string;
        toAddress: string;
        blockNum: string;
        hash: string;
        value: number;
        asset: string;
        category: string;
        rawContract: {
          rawValue: string;
          decimals: number;
        };
      },
    ];
  };
}
