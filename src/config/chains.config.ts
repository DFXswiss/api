export interface EvmChainStaticConfig {
  chainId: number;
  gatewayUrl: string;
  swapContractAddress?: string;
  quoteContractAddress?: string;
  swapFactoryAddress?: string;
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
    gatewayUrl: 'http://10.0.1.6:8085',
  },
  citrea: {
    chainId: 4114,
    gatewayUrl: 'http://10.0.1.6:8085',
  },
} satisfies Record<string, EvmChainStaticConfig>;

export type EvmChainName = keyof typeof EVM_CHAINS;
