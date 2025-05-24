export enum C2BPaymentProvider {
    BINANCE_PAY = 'BinancePay',
}

export const C2BPaymentLinkProvider = {
    BINANCE_PAY: C2BPaymentProvider.BINANCE_PAY,
} as const;

export type C2BPaymentLinkProvider = (typeof C2BPaymentProvider)[keyof typeof C2BPaymentProvider];
