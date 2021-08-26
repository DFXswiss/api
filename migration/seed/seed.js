const { createConnection } = require("typeorm");
const { AssetSeed } = require('./asset.seed');
const { LanguageSeed } = require('./language.seed');
const { WalletSeed } = require('./wallet.seed');
const { FiatSeed } = require('./fiat.seed');
const { CountrySeed } = require('./country.seed');

async function doSeed() {
    const connection = await createConnection()
    await connection.getRepository('asset').save(AssetSeed);
    await connection.getRepository('language').save(LanguageSeed);
    await connection.getRepository('wallet').save(WalletSeed);
    await connection.getRepository('fiat').save(FiatSeed);
    await connection.getRepository('country').save(CountrySeed);
}

doSeed().then();