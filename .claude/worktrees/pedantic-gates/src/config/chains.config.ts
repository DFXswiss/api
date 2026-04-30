export interface EvmChainStaticConfig {
  chainId: number;
  gatewayUrl: string;
  swapContractAddress?: string;
  quoteContractAddress?: string;
  swapFactoryAddress?: string;
  swapGatewayAddress?: string;
}

export const EVM_CHAINS = {
  ethereum: {
    chainId: 1,
    gatewayUrl: 'https://eth-mainnet.g.alchemy.com/v2',
    swapContractAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    quoteContractAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  },
  sepolia: {
    chainId: 11155111,
    gatewayUrl: 'https://eth-sepolia.g.alchemy.com/v2',
    swapContractAddress: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
    quoteContractAddress: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
  },
  optimism: {
    chainId: 10,
    gatewayUrl: 'https://opt-mainnet.g.alchemy.com/v2',
    swapContractAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    quoteContractAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  },
  arbitrum: {
    chainId: 42161,
    gatewayUrl: 'https://arb-mainnet.g.alchemy.com/v2',
    swapContractAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    quoteContractAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  },
  polygon: {
    chainId: 137,
    gatewayUrl: 'https://polygon-mainnet.g.alchemy.com/v2',
    swapContractAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    quoteContractAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  },
  base: {
    chainId: 8453,
    gatewayUrl: 'https://base-mainnet.g.alchemy.com/v2',
    swapContractAddress: '0x2626664c2603336E57B271c5C0b26F421741e481',
    quoteContractAddress: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    swapFactoryAddress: '0x33128a8fc17869897dce68ed026d694621f6fdfd',
  },
  gnosis: {
    chainId: 100,
    gatewayUrl: 'https://gnosis-mainnet.g.alchemy.com/v2',
  },
  bsc: {
    chainId: 56,
    gatewayUrl: 'https://bnb-mainnet.g.alchemy.com/v2',
    swapContractAddress: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
    quoteContractAddress: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
  },
  citreaTestnet: {
    chainId: 5115,
    gatewayUrl: 'https://rpc.testnet.citreascan.com',
    swapContractAddress: '0x26C106BC45E0dd599cbDD871605497B2Fc87c185',
    swapFactoryAddress: '0xdd6Db52dB41CE2C03002bB1adFdCC8E91C594238',
    quoteContractAddress: '0x719a4C7B49E5361a39Dc83c23b353CA220D9B99d',
    swapGatewayAddress: '0x8eE3Dd585752805A258ad3a963949a7c3fec44eB',
  },
  citrea: {
    chainId: 4114,
    gatewayUrl: 'https://rpc.citreascan.com',
    swapContractAddress: '0x565eD3D57fe40f78A46f348C220121AE093c3cF8',
    swapFactoryAddress: '0xd809b1285aDd8eeaF1B1566Bf31B2B4C4Bba8e82',
    quoteContractAddress: '0x428f20dd8926Eabe19653815Ed0BE7D6c36f8425',
    swapGatewayAddress: '0xAFcfD58Fe17BEb0c9D15C51D19519682dFcdaab9',
  },
} satisfies Record<string, EvmChainStaticConfig>;

export type EvmChainName = keyof typeof EVM_CHAINS;
