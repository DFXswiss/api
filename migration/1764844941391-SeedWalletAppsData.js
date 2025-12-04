/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SeedWalletAppsData1764844941391 {
    name = 'SeedWalletAppsData1764844941391'

    async up(queryRunner) {
        // Seed wallet apps data
        await queryRunner.query(`
            INSERT INTO wallet_app (name, websiteUrl, iconUrl, deepLink, hasActionDeepLink, appStoreUrl, playStoreUrl, recommended, blockchains, assets, semiCompatible, active)
            VALUES
            -- RECOMMENDED APPS
            ('Cake Wallet', 'https://cakewallet.com/', 'https://dfx.swiss/images/app/CakeWallet.webp', 'cakewallet:', NULL, 'https://apps.apple.com/app/cake-wallet-for-xmr-monero/id1334702542', 'https://play.google.com/store/apps/details?id=com.cakewallet.cake_wallet', 1, 'Bitcoin;Monero;EvmBlockchains', NULL, NULL, 1),
            ('Frankencoin', 'https://frankencoin.app/', 'https://dfx.swiss/images/app/Frankencoin.webp', NULL, NULL, 'https://apps.apple.com/app/frankencoin-wallet/id6480348701', 'https://play.google.com/store/apps/details?id=swiss.dfx.frankencoin_wallet', 1, 'EvmBlockchains', NULL, NULL, 1),
            ('Phoenix', 'https://phoenix.acinq.co/', 'https://dfx.swiss/images/app/Phoenix.webp', 'phoenix:', NULL, 'https://apps.apple.com/app/phoenix-wallet/id1544097028', 'https://play.google.com/store/apps/details?id=fr.acinq.phoenix.mainnet', 1, 'Lightning', NULL, NULL, 1),
            ('Wallet of Satoshi', 'https://www.walletofsatoshi.com/', 'https://dfx.swiss/images/app/WalletofSatoshi.webp', 'walletofsatoshi:', NULL, 'https://apps.apple.com/app/wallet-of-satoshi/id1438599608', 'https://play.google.com/store/apps/details?id=com.livingroomofsatoshi.wallet', 1, 'Lightning', NULL, NULL, 1),
            ('BtcTaro', 'https://dfx.swiss/bitcoin.html', 'https://dfx.swiss/images/app/BTCTaroDFX.webp', 'dfxtaro:', NULL, 'https://apps.apple.com/app/dfx-btc-taproot-asset-wallet/id6466037617', 'https://play.google.com/store/apps/details?id=swiss.dfx.bitcoin', 1, 'Lightning', NULL, NULL, 1),
            ('Binance', NULL, 'https://dfx.swiss/images/app/BinanceApp.webp', 'bnc:', NULL, 'https://apps.apple.com/app/binance-buy-bitcoin-crypto/id1436799971', 'https://play.google.com/store/apps/details?id=com.binance.dev', 1, 'BinancePay', NULL, NULL, 1),
            -- COMPATIBLE APPS
            ('BitBanana', 'https://bitbanana.app/', 'https://dfx.swiss/images/app/BitBanana.webp', 'lightning:', NULL, NULL, 'https://play.google.com/store/apps/details?id=app.michaelwuensch.bitbanana', NULL, 'Lightning', NULL, NULL, 1),
            ('Bitkit', 'https://bitkit.to/', 'https://dfx.swiss/images/app/Bitkit.webp', 'bitkit:', NULL, 'https://apps.apple.com/app/bitkit-bitcoin-ln-wallet/id6502440655', 'https://play.google.com/store/apps/details?id=to.bitkit', NULL, 'Lightning', NULL, NULL, 1),
            ('Blink', 'https://de.blink.sv/', 'https://dfx.swiss/images/app/Blink.webp', 'lightning:', NULL, 'https://apps.apple.com/app/blink-bitcoin-beach-wallet/id1531383905', 'https://play.google.com/store/apps/details?id=com.galoyapp', NULL, 'Lightning', NULL, NULL, 1),
            ('Blitz Wallet', 'https://blitz-wallet.com/', 'https://dfx.swiss/images/app/BlitzWalletApp.webp', 'lightning:', NULL, NULL, 'https://play.google.com/store/apps/details?id=com.blitzwallet', NULL, 'Lightning', NULL, NULL, 1),
            ('Blixt', 'https://blixtwallet.com/', 'https://dfx.swiss/images/app/Blixt.webp', NULL, NULL, NULL, 'https://play.google.com/store/apps/details?id=com.blixtwallet', NULL, 'Lightning', NULL, NULL, 1),
            ('Breez', 'https://breez.technology/', 'https://dfx.swiss/images/app/Breez.webp', 'breez:', NULL, 'https://apps.apple.com/app/breez-lightning-client-pos/id1463604142', 'https://play.google.com/store/apps/details?id=com.breez.client', NULL, 'Lightning', NULL, NULL, 1),
            ('CoinCorner', 'https://www.coincorner.com/', 'https://dfx.swiss/images/app/CoinCorner.webp', 'lightning:', NULL, 'https://apps.apple.com/app/coincorner-checkout/id1464880599', 'https://play.google.com/store/apps/details?id=com.coincorner.app.crypt', NULL, 'Lightning', NULL, NULL, 1),
            ('DEURO Wallet', 'https://deuro.com/', 'https://dfx.swiss/images/app/DeuroWallet.webp', NULL, NULL, 'https://apps.apple.com/ch/app/deuro-wallet/id6746087643', 'https://play.google.com/store/apps/details?id=eu.deurowallet.wallet', NULL, 'EvmBlockchains', NULL, NULL, 1),
            ('LifPay', 'https://lifpay.me/', 'https://dfx.swiss/images/app/LifPay.webp', 'lifpay:', NULL, 'https://apps.apple.com/app/lifpay/id1645840182', 'https://play.google.com/store/apps/details?id=flutter.android.LifePay', NULL, 'Lightning', NULL, NULL, 1),
            ('LipaWallet', 'https://lipa.swiss/', 'https://dfx.swiss/images/app/lipawallet.webp', NULL, NULL, 'https://apps.apple.com/app/lipa-wallet/id1658329527', 'https://play.google.com/store/apps/details?id=com.getlipa.wallet', NULL, 'Lightning', NULL, NULL, 1),
            ('LNbits', 'https://lnbits.com/', 'https://dfx.swiss/images/app/LNbits.webp', NULL, NULL, NULL, 'https://play.google.com/store/apps/details?id=com.lnbits.app', NULL, 'Lightning', NULL, NULL, 1),
            ('AQUA', 'https://aquawallet.io/', 'https://dfx.swiss/images/app/aqua.webp', NULL, NULL, 'https://apps.apple.com/app/aqua-wallet/id6468594241', 'https://play.google.com/store/apps/details?id=io.aquawallet.android', NULL, 'Lightning', NULL, NULL, 1),
            ('OneKey', 'https://onekey.so/', 'https://dfx.swiss/images/app/OneKey.webp', NULL, NULL, 'https://apps.apple.com/app/onekey-crypto-defi-wallet/id1609559473', 'https://play.google.com/store/apps/details?id=so.onekey.app.wallet', NULL, 'Lightning', NULL, NULL, 1),
            ('PouchPH', 'https://pouch.ph/', 'https://dfx.swiss/images/app/Pouchph.webp', 'pouch:', NULL, 'https://apps.apple.com/app/pouch-lightning-wallet/id1584404678', 'https://play.google.com/store/apps/details?id=pouch.ph', NULL, 'Lightning', NULL, NULL, 1),
            ('ZEBEDEE', 'https://zbd.gg/', 'https://dfx.swiss/images/app/ZEBEDEE.webp', 'zebedee:', NULL, 'https://apps.apple.com/app/zebedee-play-earn-shop/id1484394401', 'https://play.google.com/store/apps/details?id=io.zebedee.wallet', NULL, 'Lightning', NULL, NULL, 1),
            ('Zeus', 'https://zeusln.com/', 'https://dfx.swiss/images/app/Zeus.webp', 'lightning:', NULL, 'https://apps.apple.com/app/zeus-wallet/id1456038895', 'https://play.google.com/store/apps/details?id=app.zeusln.zeus', NULL, 'Lightning', NULL, NULL, 1),
            -- SEMI COMPATIBLE APPS
            ('Muun', 'https://muun.com/', 'https://dfx.swiss/images/app/Muun.webp', 'muun:', NULL, 'https://apps.apple.com/us/app/muun-wallet/id1482037683', 'https://play.google.com/store/apps/details?id=io.muun.apollo', NULL, 'Lightning', NULL, 1, 1),
            ('KuCoin Pay', 'https://kucoin.com/', 'https://dfx.swiss/images/app/KucoinApp.webp', 'kucoinpay:', NULL, 'https://kucoin-ios.onelink.me/L1k4/18p1goqs', 'https://kucoin-android.onelink.me/xTQQ/pvve7hp8', NULL, 'KucoinPay', NULL, 1, 1),
            ('Bridge Wallet', 'https://www.mtpelerin.com/de/bridge-wallet', 'https://dfx.swiss/images/app/bridge-wallet-icon.webp', 'bridgewallet:', NULL, 'https://apps.apple.com/app/bridge-wallet/id1481859680', 'https://play.google.com/store/apps/details?id=com.mtpelerin.bridge', NULL, 'Bitcoin;Lightning;EvmBlockchains', NULL, 1, 1)
        `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM wallet_app WHERE name IN ('Cake Wallet', 'Frankencoin', 'Phoenix', 'Wallet of Satoshi', 'BtcTaro', 'Binance', 'BitBanana', 'Bitkit', 'Blink', 'Blitz Wallet', 'Blixt', 'Breez', 'CoinCorner', 'DEURO Wallet', 'LifPay', 'LipaWallet', 'LNbits', 'AQUA', 'OneKey', 'PouchPH', 'ZEBEDEE', 'Zeus', 'Muun', 'KuCoin Pay', 'Bridge Wallet')`);
    }
}
