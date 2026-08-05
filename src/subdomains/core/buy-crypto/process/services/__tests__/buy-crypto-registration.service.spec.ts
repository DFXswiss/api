import { createMock } from '@golevelup/ts-jest';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomCryptoRoute } from 'src/subdomains/core/buy-crypto/routes/swap/__mocks__/crypto-route.entity.mock';
import { SwapRepository } from 'src/subdomains/core/buy-crypto/routes/swap/swap.repository';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { CryptoInput, PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { In } from 'typeorm';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoRegistrationService } from '../buy-crypto-registration.service';
import { BuyCryptoService } from '../buy-crypto.service';

/**
 * The route scan runs on every buy-crypto cron tick and used to read the whole swap table as full
 * entities. These tests pin what makes it cheap — the candidate scan selects three raw columns —
 * and, more importantly, that narrowing the read did not change which route a pay-in is paired
 * with. A pay-in bound to the wrong route misroutes customer funds, so the pairing tests use two
 * pay-ins and two routes: with a single one of each, any mix-up is invisible.
 */
describe('BuyCryptoRegistrationService', () => {
  let service: BuyCryptoRegistrationService;
  let swapRepo: jest.Mocked<SwapRepository>;
  let payInService: jest.Mocked<PayInService>;
  let buyCryptoRepo: jest.Mocked<BuyCryptoRepository>;
  let buyCryptoService: jest.Mocked<BuyCryptoService>;
  let transactionHelper: jest.Mocked<TransactionHelper>;
  let builder: { select: jest.Mock; addSelect: jest.Mock; innerJoin: jest.Mock; getRawMany: jest.Mock };

  const candidate = (id: number, address: string, blockchains: string) => ({ id, address, blockchains });

  const fullRoute = (id: number) => createCustomCryptoRoute({ id });

  const depositPayIn = (id: number, address: string, blockchain = Blockchain.BITCOIN) =>
    createCustomCryptoInput({ id, address: { address, blockchain } as never, txType: PayInType.DEPOSIT });

  // isPayment is a getter over txType, so the payment branch is selected through txType.
  const paymentPayIn = (id: number, routeId: number) =>
    createCustomCryptoInput({
      id,
      address: { address: 'irrelevant', blockchain: Blockchain.ETHEREUM } as never,
      txType: PayInType.PAYMENT,
      paymentLinkPayment: { link: { route: { id: routeId }, linkConfigObj: {} } } as never,
    });

  const routesPairedWith = (): [number, number][] =>
    buyCryptoService.createFromCryptoInput.mock.calls.map(([payIn, route]) => [
      (payIn as CryptoInput).id,
      (route as { id: number }).id,
    ]);

  const routeArgAt = (call: number) => buyCryptoService.createFromCryptoInput.mock.calls[call][1];

  // registerCryptoPayIn swallows every exception, so a test asserting only that things were NOT
  // called also passes when the body throws. Asserting no error was logged closes that hole;
  // asserting getRawMany alone does not, because it runs before anything that could throw.
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    swapRepo = createMock<SwapRepository>();
    payInService = createMock<PayInService>();
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    buyCryptoService = createMock<BuyCryptoService>();
    transactionHelper = createMock<TransactionHelper>();

    builder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    (swapRepo.createQueryBuilder as jest.Mock).mockReturnValue(builder);

    buyCryptoRepo.existsBy.mockResolvedValue(false);
    transactionHelper.validateInput.mockResolvedValue(true);

    service = new BuyCryptoRegistrationService(
      buyCryptoRepo,
      buyCryptoService,
      swapRepo,
      payInService,
      transactionHelper,
    );

    errorLog = jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  it('scans candidates as raw rows over an inner join, without building entities', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'addr-1')]);

    await service.registerCryptoPayIn();

    expect(builder.innerJoin).toHaveBeenCalledWith('swap.deposit', 'deposit');
    expect(builder.select).toHaveBeenCalledWith('swap.id', 'id');
    expect(builder.addSelect).toHaveBeenCalledWith('deposit.address', 'address');
    expect(builder.addSelect).toHaveBeenCalledWith('deposit.blockchains', 'blockchains');
    expect(builder.getRawMany).toHaveBeenCalled();
    expect(swapRepo.find).not.toHaveBeenCalled();
  });

  it('does not read routes back when nothing matched', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'no-such-address')]);
    builder.getRawMany.mockResolvedValue([candidate(1, 'addr-1', Blockchain.BITCOIN)]);

    await service.registerCryptoPayIn();

    expect(errorLog).not.toHaveBeenCalled();
    expect(swapRepo.find).not.toHaveBeenCalled();
    expect(buyCryptoService.createFromCryptoInput).not.toHaveBeenCalled();
  });

  it('reads back exactly the matched route ids', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'addr-7')]);
    builder.getRawMany.mockResolvedValue([
      candidate(1, 'addr-1', Blockchain.BITCOIN),
      candidate(7, 'addr-7', Blockchain.BITCOIN),
    ]);
    swapRepo.find.mockResolvedValue([fullRoute(7)]);

    await service.registerCryptoPayIn();

    expect(swapRepo.find).toHaveBeenCalledWith({
      where: { id: In([7]) },
      relations: { deposit: true, user: { userData: true, wallet: true } },
    });
  });

  it('pairs each pay-in with its own route, whatever order the read-back returns', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(11, 'addr-a'), depositPayIn(22, 'addr-b')]);
    builder.getRawMany.mockResolvedValue([
      candidate(101, 'addr-a', Blockchain.BITCOIN),
      candidate(202, 'addr-b', Blockchain.BITCOIN),
    ]);
    // deliberately reversed relative to the matches
    swapRepo.find.mockResolvedValue([fullRoute(202), fullRoute(101)]);

    await service.registerCryptoPayIn();

    expect(routesPairedWith()).toEqual([
      [11, 101],
      [22, 202],
    ]);
    // the id list must carry every match, not just the first
    expect(swapRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: In([101, 202]) } }));
  });

  // The whole point of the second read: downstream gets the entity, with its user graph and eager
  // asset, not the three-column row the match was made on. Asserted by identity — comparing ids
  // would pass on the raw row too, since it carries the same id.
  it('hands the read-back entity downstream, not the candidate row', async () => {
    const entity = fullRoute(7);
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'addr-7')]);
    builder.getRawMany.mockResolvedValue([candidate(7, 'addr-7', Blockchain.BITCOIN)]);
    swapRepo.find.mockResolvedValue([entity]);

    await service.registerCryptoPayIn();

    expect(routeArgAt(0)).toBe(entity);
    expect(payInService.acknowledgePayIn).toHaveBeenCalledWith(1, expect.anything(), entity);
  });

  it('pairs two pay-ins that share one route with the same entity', async () => {
    const entity = fullRoute(7);
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(11, 'addr-7'), depositPayIn(22, 'addr-7')]);
    builder.getRawMany.mockResolvedValue([candidate(7, 'addr-7', Blockchain.BITCOIN)]);
    swapRepo.find.mockResolvedValue([entity]);

    await service.registerCryptoPayIn();

    expect(routesPairedWith()).toEqual([
      [11, 7],
      [22, 7],
    ]);
    expect(routeArgAt(0)).toBe(entity);
    expect(routeArgAt(1)).toBe(entity);
  });

  it('matches the deposit address case-insensitively', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'abcdef')]);
    builder.getRawMany.mockResolvedValue([candidate(7, 'AbCdEf', Blockchain.BITCOIN)]);
    swapRepo.find.mockResolvedValue([fullRoute(7)]);

    await service.registerCryptoPayIn();

    expect(routesPairedWith()).toEqual([[1, 7]]);
  });

  // Mirror of the case above: neither side is normalised on write, and Tron, Solana, Monero and
  // Cardano addresses are mixed-case base58. Folding only the route side would mean no pay-in on
  // those chains ever matches — retried every minute, never registered, never logged.
  it('matches a mixed-case pay-in address against a lower-case deposit', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'AbCdEf')]);
    builder.getRawMany.mockResolvedValue([candidate(7, 'abcdef', Blockchain.BITCOIN)]);
    swapRepo.find.mockResolvedValue([fullRoute(7)]);

    await service.registerCryptoPayIn();

    expect(routesPairedWith()).toEqual([[1, 7]]);
  });

  it('does not match a partial address', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'addr')]);
    builder.getRawMany.mockResolvedValue([candidate(7, 'addr-7', Blockchain.BITCOIN)]);

    await service.registerCryptoPayIn();

    expect(errorLog).not.toHaveBeenCalled();
    expect(swapRepo.find).not.toHaveBeenCalled();
    expect(buyCryptoService.createFromCryptoInput).not.toHaveBeenCalled();
  });

  it('does not match a route whose deposit excludes the pay-in blockchain', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'addr-7', Blockchain.ETHEREUM)]);
    builder.getRawMany.mockResolvedValue([candidate(7, 'addr-7', Blockchain.BITCOIN)]);

    await service.registerCryptoPayIn();

    expect(errorLog).not.toHaveBeenCalled();
    expect(swapRepo.find).not.toHaveBeenCalled();
    expect(buyCryptoService.createFromCryptoInput).not.toHaveBeenCalled();
  });

  it('does not match a chain absent from a multi-chain deposit', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'addr-7', Blockchain.BASE)]);
    builder.getRawMany.mockResolvedValue([candidate(7, 'addr-7', `${Blockchain.ETHEREUM};${Blockchain.ARBITRUM}`)]);

    await service.registerCryptoPayIn();

    expect(errorLog).not.toHaveBeenCalled();
    expect(swapRepo.find).not.toHaveBeenCalled();
    expect(buyCryptoService.createFromCryptoInput).not.toHaveBeenCalled();
  });

  it('matches a later entry of a multi-chain deposit', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'addr-7', Blockchain.ARBITRUM)]);
    builder.getRawMany.mockResolvedValue([
      candidate(7, 'addr-7', `${Blockchain.ETHEREUM};${Blockchain.ARBITRUM};${Blockchain.BASE}`),
    ]);
    swapRepo.find.mockResolvedValue([fullRoute(7)]);

    await service.registerCryptoPayIn();

    expect(routesPairedWith()).toEqual([[1, 7]]);
  });

  // The sell side matches chains with a plain substring test on the joined string. This case is the
  // reason the buy side splits instead: 'BitcoinTestnet4'.includes('Bitcoin') is true, so a substring
  // match would route a mainnet pay-in to a testnet deposit.
  it('does not match a chain that is only a prefix of the deposit chain', async () => {
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'addr-7', Blockchain.BITCOIN)]);
    builder.getRawMany.mockResolvedValue([candidate(7, 'addr-7', Blockchain.BITCOIN_TESTNET4)]);

    await service.registerCryptoPayIn();

    expect(errorLog).not.toHaveBeenCalled();
    expect(swapRepo.find).not.toHaveBeenCalled();
    expect(buyCryptoService.createFromCryptoInput).not.toHaveBeenCalled();
  });

  it('matches a payment pay-in by route id, which the projection must still carry', async () => {
    payInService.getNewPayIns.mockResolvedValue([paymentPayIn(1, 7)]);
    builder.getRawMany.mockResolvedValue([
      candidate(3, 'other', Blockchain.BITCOIN),
      candidate(7, 'irrelevant', Blockchain.BITCOIN),
    ]);
    swapRepo.find.mockResolvedValue([fullRoute(7)]);

    await service.registerCryptoPayIn();

    expect(routesPairedWith()).toEqual([[1, 7]]);
  });

  it('skips and logs a pay-in whose route disappeared between the two reads', async () => {
    const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(1, 'addr-7')]);
    builder.getRawMany.mockResolvedValue([candidate(7, 'addr-7', Blockchain.BITCOIN)]);
    swapRepo.find.mockResolvedValue([]);

    await service.registerCryptoPayIn();

    // both reads happened: the pair was made and then lost, rather than never matching at all
    expect(swapRepo.find).toHaveBeenCalledTimes(1);
    expect(builder.getRawMany).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vanished before read-back'));
    expect(buyCryptoService.createFromCryptoInput).not.toHaveBeenCalled();
    expect(payInService.acknowledgePayIn).not.toHaveBeenCalled();
  });

  it('keeps processing the batch after skipping a vanished route', async () => {
    jest.spyOn(service['logger'], 'warn').mockImplementation();
    payInService.getNewPayIns.mockResolvedValue([depositPayIn(11, 'addr-gone'), depositPayIn(22, 'addr-ok')]);
    builder.getRawMany.mockResolvedValue([
      candidate(101, 'addr-gone', Blockchain.BITCOIN),
      candidate(202, 'addr-ok', Blockchain.BITCOIN),
    ]);
    // only the second route survives to the read-back
    swapRepo.find.mockResolvedValue([fullRoute(202)]);

    await service.registerCryptoPayIn();

    expect(routesPairedWith()).toEqual([[22, 202]]);
  });
});
