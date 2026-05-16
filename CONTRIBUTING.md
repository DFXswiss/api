# Contributing Guidelines

## Build & Test

```bash
npm install
npm run format        # prettier --write
npm run lint          # eslint
npm run type-check    # tsc --noEmit
npm test              # jest
npm run migration <Name>   # generate migration from entity diff
```

Run `format`, `lint` and `type-check` before pushing.

## Git & PRs

- Branch from `develop`, never commit directly.
- Feature branches: `feat/<scope>-<topic>`, fixes: `fix/<scope>-<topic>`.
- Commit messages: imperative mood, no trailing period on the subject.
- Squash-and-merge when merging to `develop` — the squash keeps only the PR title.
- Release PRs (`develop` → `main`) are created automatically — never open them manually.

### PR Completeness

Every PR must include:
1. **Migration** (if entity/column changes)
2. **Environment/Infrastructure updates** (config, environment variables)
3. **Service updates** (if DTOs/interfaces changed)
4. **Frontend synchronization** (if API contracts changed)

Missing any of these = changes requested.

### Before Merge

- Fix all linter errors and warnings (never disable lint rules without justification)
- Fix formatting (`npm run format`)
- Remove all `console.log` / debug statements
- Resolve all TODO comments
- Remove merge markers
- Check if changes need to be mirrored in related repos

---

## General Principles

- **Clarity over cleverness** — readable code beats short but obscure expressions
- **Consistency** — same patterns everywhere (naming, enum style, await handling)
- **Minimal changes** — use existing Util methods, don't reinvent the wheel
- **Right layer** — logic belongs in entities, not services; config in Config, not scattered
- **Type safety** — no `any`, no `string` where enums exist, always add return types
- **Performance awareness** — filter in SQL not JS, use IDs not full entities in queries
- **Clean API** — use DTOs, never expose entities, document with ApiProperty
- **No over-engineering** — don't build it if the existing solution works
- **Use existing packages** — use `@dfx.swiss/*` packages instead of duplicating logic

---

## Naming Conventions

### General Rules

- **camelCase everywhere**: variables, config keys, URL routes, entity fields
- **camelCase for abbreviations**: `getUserByKycCode` not `getUserByKYCCode`, `dfiOrders` not `DFIOrders`
- **American English spelling**: `blankCenter` not `blankCentre`
- **Plural for collections**: `buys: Buy[]` not `buy: Buy[]`, `blockedIbans` not `blockedIban`
- **Boolean flags: positive naming**: `safetyModeActive` not `safetyModuleInactive`
- **Short, descriptive names — no redundant prefixes**: `uid` not `transactionRequestUid`, `balances` not `assetBalances`, `txId` not `transactionId`
- **Variable names must precisely reflect the data**: `priceChf` not `amountChf` for a price

### Methods

- **Methods are verbs**: `logExists()`, `startNextStep()`, `cancelPayment()`
- **Must describe what they do, not the implementation**: `sendAutoResponses` not `sendAutoTemplates`
- **Boolean getters use `is`/`has`**: `isValid()`, `hasRole()`
- **Invert negative names**: `isDfxUser` not `isExternalUser`
- **No method-forwarding without logic**: if a service method only delegates to a sub-service without adding value, remove it

### Service Classes

- **Name services by function**: `KycSchedulerService` not generic `KycService` if it only handles scheduling
- **Suffix reflects responsibility**: `*SchedulerService`, `*NotificationService`, `*ValidationService`

### Enums

- **Keys: UPPER_SNAKE_CASE**
- **Values: PascalCase strings**: `BITCOIN = 'Bitcoin'`, `CREATED = 'Created'`
- **Never**: `INVOICE = 'INVOICE'` or `active = 'active'`
- **Error enums use Mismatch pattern**: `CardNameMismatch` not `CARD_NAME_NOT_MATCHING`
- **Reuse existing enum values**: check if an existing error/status fits before creating a new one

### Files

- **Entity files**: `*.entity.ts` (not just `*.ts`)
- **Enum files**: `*.enum.ts`
- **Generated files**: `YYYYMMDD-Type-X-EntityId-HHMMSS` (e.g. `20250402-NameCheck-0-311124-163302.pdf`)
- **No custom naming for TypeORM indexes**

### DTOs

- **PascalCase for class names**: `DbQueryDto` not `dbQueryDto`
- **Name must reflect purpose**: `GetBuyPaymentInfoDto` not `CreateBuyPaymentInfoDto` if it's a getter
- **Field order aligned with entity field order** for easy scanning

### Cache Keys

- **Descriptive cache keys**: `user-${userData.id}` not just `${userData.id}` (avoids ID conflicts across entity types)
- **Named caches**: `blockchainFeeCache` not `cache`, `feeCache` not `arrayCache`
- **Include all variable parameters**: use `JSON.stringify(request)` as cache key when relations/filters vary

### Error Messages

- **Capital letter at start**: `BankAccount not found` not `bankAccount not found`
- **Consistency**: same casing and style across all exception messages

---

## Code Style

### Prefer Compact Code

```typescript
// BAD: unnecessary intermediate variable
const result = await this.service.getData();
return result;

// GOOD: return directly
return this.service.getData();
```

```typescript
// BAD: unnecessary destructure + reconstruct
const { fee, refBonus } = await this.userService.getUserBuyFee(userId, volume);
return { fee, refBonus };

// GOOD
return this.userService.getUserBuyFee(userId, volume);
```

```typescript
// BAD
return this.dfxEnable ? true : false;

// GOOD
return this.dfxEnable;
```

### Nullish Operators

```typescript
// Use ?? not ||
value ?? defaultValue    // not: value || defaultValue

// Use ??= for default assignment
dto.blockchain ??= Blockchain.DEFICHAIN;
// not: if (!dto.blockchain) dto.blockchain = Blockchain.DEFICHAIN;

// Use ?. for optional chaining
if (!users?.length)      // not: if (!users || users.length === 0)
```

### Math.max / Math.min over Ternary

```typescript
// BAD
const amount = availableAmount > 0 ? availableAmount : 0;

// GOOD
const amount = Math.max(availableAmount, 0);
```

### Array Methods

```typescript
// Use .map() not for-loop + push
return banks.map(BankMapper.toDto);

// Use .includes() not .some() for equality
ipBlacklist.includes(ip);  // not: ipBlacklist.some(b => b === ip)

// Use .some() not .find() for boolean checks
items.some(i => i.active);  // not: !!items.find(i => i.active)

// Use .find() not .filter()[0]
items.find(i => i.id === id);  // not: items.filter(i => i.id === id)[0]

// Use .endsWith() / .startsWith() for string checks
key.endsWith('0');  // not: key.charAt(key.length - 1) === '0'

// Sort by difference not comparison
transfers.sort((a, b) => b.timestamp - a.timestamp);
// not: transfers.sort((a, b) => a.timestamp > b.timestamp ? -1 : 1);
```

### Destructuring

```typescript
const { k1, signature, key } = signupDto;
const [field, select] = entry.split('-');
for (const [blockchain, assets] of map.entries()) { ... }
```

### .then() for Mapping Chains

```typescript
return this.paymentLinkService.get(id).then(PaymentLinkDtoMapper.toLinkDto);
return this.kycService.getCountries(code).then(CountryDtoMapper.entitiesToDto);
```

### Strict Equality

Always `===`, never `==`.

### Rounding

```typescript
// Always round divisions — JS is bad with floating-point
Util.round(value / divisor, 2);
```

### Use Existing Util Methods

```typescript
Util.round()            Util.sumObjValue()       Util.avg()
Util.daysBefore()       Util.daysAfter()         Util.daysDiff()
Util.groupBy()          Util.randomString()      Util.trim
Util.removeNullFields() Util.doInBatches()       Util.doInBatchesAndJoin()
```

Never reinvent what Util already provides.

### Use Config Patterns

```typescript
// Use Config.formats for regex checks
Config.formats.bankUsage.test(key);
Config.formats.address.test(address);

// Use Config.xxx not GetConfig().xxx
Config.scrypt;  // not: GetConfig().scrypt

// Use factors not percentages internally
0.012  // not: 1.2%
```

### Complex Expressions — Split into Variables

```typescript
// BAD: nested ternary soup
return a ? (b ? x : y) : (c ? z : w);

// GOOD: named intermediates
const percentFeeAmount = ...;
const feeAmount = ...;
return Math.max(percentFeeAmount, feeAmount);
```

### Imports

```typescript
// Absolute paths, never relative
import { UserService } from 'src/subdomains/generic/user/services/user.service';
// not: import { UserService } from '../../user/services/user.service';

// Alphabetically sorted, multi-imports on separate lines
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
```

### Trailing Commas

Always use trailing commas in multi-line objects, arrays, and argument lists.

### Section Comments

Use the `// --- NAME --- //` style for major sections:

```typescript
// --- AUTH METHODS --- //
// --- HELPER METHODS --- //
```

### URL Construction

```typescript
const url = `${baseUrl}/${encodeURIComponent(name)}`;
// not: url.split(' ')?.join('%20')
```

### Comments

- **English only**: no German comments in code
- **Remove stale comments**: delete comments that no longer reflect the code
- **Remove commented-out code**: dead code must be deleted
- **TODOs must be resolved before merge**
- **Currency hints on numeric config**: `maxBlockchainFee = 50; // CHF`
- **No AI-generated comments**: especially not in other languages

---

## Architecture

### Domain-Driven Structure

```
src/subdomains/
  generic/        # shared domain models (user, kyc, support, ...)
  supporting/     # infrastructure-level domains (bank-tx, mros, recall, ...)
  core/           # business flows (buy-crypto, sell-crypto, ...)
```

Within a subdomain:

```
<domain>/
  dto/
    create-<domain>.dto.ts
    update-<domain>.dto.ts
  <domain>.entity.ts
  <domain>.repository.ts
  <domain>.service.ts
  <domain>.controller.ts
  <domain>.module.ts
```

Entities, DTOs, services stay in their domain. Move code to the correct domain, never duplicate.

### Logic Belongs in Entities

```typescript
// GOOD: computed properties and getters on the entity
class UserData extends IEntity {
  get tradingLimit(): TradingLimit { ... }
  get isDfxUser(): boolean { ... }
  get hasActiveUser(): boolean { ... }
}

// BAD: business logic in service
class UserService {
  getTradingLimit(userData: UserData): TradingLimit { ... }
}
```

Entities carry computed properties, state transitions, and validation. State transitions use the `UpdateResult` pattern:

```typescript
// The dominant entity pattern — 100+ usages across the codebase
setPriceInvalidStatus(): UpdateResult<BuyCrypto> {
  const update: Partial<BuyCrypto> = {
    status: BuyCryptoStatus.PRICE_INVALID,
    ...this.resetTransaction(),
  };

  Object.assign(this, update);

  return [this.id, update];
}
```

This returns `[id, changedFields]` so the caller can do a targeted `repo.update(id, update)` instead of a full `repo.save(entity)`.

### Services vs Controllers

- **Controllers**: thin, delegate to services, never contain business logic
- **Services**: orchestrate business logic, call repositories
- **Repositories**: data access only, extend `BaseRepository<T>` (or `CachedRepository<T>` for frequently accessed reference data like assets, fiats, countries)

### Module Structure

- Services/repos should be provided in exactly **one** module
- Never provide the same service in multiple modules — import from the owning module
- Do not export repositories directly — export services
- `@Injectable()` is not needed on static helper classes

### Composition over Inheritance

```typescript
// BAD: extending and duplicating caching
class MyClient extends EvmClient { ... }

// GOOD: composition
class MyService {
  constructor(private readonly evmClient: EvmClient) {}
}
```

### Shared Logic — DRY

- Extract helper methods for logic used across BuyCrypto/BuyFiat/Sell
- Use maps instead of switch/if-else chains (generates build errors for unmapped values):

```typescript
const PaymentMethodMap: { [method in PaymentMethod]: PaymentType } = { ... };
```

### Config in DB/Config Objects, Not in Code

```typescript
// BAD: hardcoded
const countries = ['DE', 'AT', 'CH'];

// GOOD: configurable
const countries = await this.settingService.get('allowedCountries');
// or in wallet table, or Config object
```

### No Forward Refs Unless Necessary

Remove `@Inject(forwardRef(() => ...))` when circular dependencies can be resolved. Prefer constructor injection.

### Avoid Parameter Threading

```typescript
// BAD: passing walletName through 4+ method layers
translate(key, walletName) -> translateParams(key, walletName) -> getMailAffix(walletName) -> ...

// GOOD: resolve context once at the top
const context = this.buildTranslationContext(wallet);
translate(key, context);
```

### Assess Filter Regression Risk

When adding a `.filter()` that affects existing data (not just new functionality), evaluate the impact on all existing consumers.

---

## TypeScript / NestJS Patterns

### Always Add Return Types

```typescript
// BAD
async getUser(id: number) { ... }

// GOOD
async getUser(id: number): Promise<User | undefined> { ... }
```

### Always `private readonly` for Injected Dependencies

```typescript
constructor(
  private readonly transactionService: TransactionService,
  private readonly repo: RecallRepository,
) {}
```

### DTO Validation

```typescript
// When Create and Update share fields, Create DTO can extend Update DTO
export class UpdateRiskAssessmentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateRiskAssessmentDto extends UpdateRiskAssessmentDto {
  @IsNotEmpty()
  @IsEnum(RiskType)
  type: RiskType;
}

// Standalone DTOs are fine when Create and Update have different shapes
```

**Key rules:**
- `@ApiPropertyOptional()` for optional fields (not `@ApiProperty()`)
- `@ApiProperty({ enum: EnumType })` for enum fields
- `@ApiProperty({ type: ChildDto, isArray: true })` for arrays
- `@Type(() => ChildDto)` + `@ValidateNested({ each: true })` for nested DTOs
- `@Transform(Util.trim)` on string inputs
- `@IsEmail()` for email fields
- `@IsNotEmpty()` required when using `@ValidateIf()`
- Interface for internal DTOs, class for external DTOs (validator decorators are useless on internal DTOs)
- **Create DTOs** (`@IsOptional()`): accept `undefined` or `null`
- **Update DTOs** (`@IsOptionalButNotNull()` from `shared/validators`): accept `undefined`, reject explicit `null`

### Service Patterns

- `create`: destructure relation ids and JSON-backed fields out of the DTO, create the entity from the rest, then attach relations and call the typed setter for JSON fields
- `update`: load the entity, `Object.assign(entity, rest)` for plain fields, use the typed setter for JSON fields when the DTO value is not `undefined`

### Swagger Documentation

- `@ApiOkResponse({ type: ResponseDto })` on endpoints
- `@ApiOperation({ deprecated: true })` on deprecated endpoints
- `@ApiExcludeEndpoint()` on admin endpoints
- `@ApiTags('Payment Link')` with space in multi-word tags

### REST Endpoints

```typescript
@Controller('support/issue')
@ApiTags('Support Issue')
export class SupportIssueController {
  @Put(':id')           // not @Post for updates
  @Delete(':id/payment') // nested resources
  @Put(':id/reset')     // not @Delete('reset/:id')
}
```

- Status 200 for GET (not 201)
- Plain string responses are annoying — return JSON objects

### Cron Jobs

Use `@DfxCron` (custom wrapper with built-in locking, process control, and error handling). It replaces `@Cron` + `@Lock` + `DisabledProcess` — never combine these manually with `@DfxCron`.

```typescript
// GOOD: @DfxCron handles everything
@DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAYMENT, timeout: 1800 })
async processPayments(): Promise<void> {
  // no @Lock, no DisabledProcess check needed
}

// ONLY with bare @Cron: manual @Lock + DisabledProcess required
@Cron(CronExpression.EVERY_MINUTE)
@Lock(1800)
async processPayments(): Promise<void> {
  if (DisabledProcess(Process.PAYMENT)) return;
  // ...
}
```

Prefer longer intervals (15min) over aggressive polling (1min). Only use short intervals when truly needed.

### Await Discipline

```typescript
// Always await async operations
await this.repo.save(entity);

// Use void for fire-and-forget (must handle errors)
void this.notificationService.send(msg).catch(e => this.logger.error('...', e));

// Don't await before return (unless inside try-catch where you need the error caught)
return this.service.getData();  // not: return await this.service.getData();
```

### No `any` Type

```typescript
// BAD
async process(data: any): Promise<any> { ... }

// GOOD
async process(data: OrderData): Promise<Transaction> { ... }
```

### Visibility

- `protected` for abstract method implementations (not public)
- `private` getter for computed values on services
- Only make methods public when other modules need them

---

## Database / TypeORM

### Entity Patterns

```typescript
@Entity()
@Index((r: Recall) => [r.bankTx, r.checkoutTx, r.sequence], { unique: true })
export class Recall extends IEntity {
  @ManyToOne(() => BankTx)
  bankTx: BankTx;

  @ManyToOne(() => CheckoutTx)
  checkoutTx: CheckoutTx;

  @Column({ type: 'int' })
  sequence: number;

  @ManyToOne(() => User, { nullable: true })
  user?: User;

  @Column({ length: 'MAX' })
  comment: string;

  @Column({ type: 'float' })
  fee: number;

  @Column({ length: 256, nullable: true })
  reason?: RecallReason;
}
```

**Rules:**
- Relations via lambda: `@ManyToOne(() => BankTx)` — never strings
- `nullable: false` explicit where needed
- `type: 'datetime2'` for date columns
- `eager: false` is the default — don't annotate it
- Use `eager: true` sparingly — explicit relation loading is preferred
- Column length always specified
- Boolean columns: `default: false` (no nullable)
- `unique: true` on uniqueId columns
- No custom index names
- New columns that existing rows can't populate → `nullable: true`
- New columns with a domain default → `default: 'value'`

### JSON-Serialised Columns

Use the getter/setter pattern for JSON data in columns:

```typescript
@Column({ length: 'MAX', nullable: true })
indicators?: string; // JSON string

get indicatorCodes(): string[] {
  return this.indicators ? JSON.parse(this.indicators) : [];
}

set indicatorCodes(codes: string[]) {
  this.indicators = JSON.stringify(codes);
}
```

Never expose the raw JSON string to business logic — always go through the typed getter/setter.

### Queries

```typescript
// Filter by ID, not full entity
{ where: { asset: { id: asset.id } } }  // not: { where: { asset } }

// Use IsNull() in TypeORM where clauses
{ where: { deletedAt: IsNull() } }  // not: null comparison

// Use In() for multiple values
{ where: { type: In([Type.A, Type.B]) } }

// Use non-string relations
relations: { user: true, buy: { route: true } }  // not: ['user', 'buy.route']

// Use select object syntax
select: { id: true, name: true }

// innerJoin over leftJoin when possible (more performant)

// Use exists() for existence checks
await this.repo.exists({ where: { ... } });  // not: findBy + length

// Use countBy() when you need a count
await this.repo.countBy({ ... });  // not: findBy + length

// Use findOne() not find() + [0]
await this.repo.findOne({ where: { ... } });

// Use update() for partial field changes
await this.repo.update(id, dto);  // not: findOne + Object.assign + save (when only changing fields)

// Prefer repository methods over query builder when possible
this.repo.find({ where: { ... }, relations: { ... } });
// not: this.repo.createQueryBuilder().andWhere().orderBy().getMany()  // unless truly complex
```

### Relation Creation

```typescript
const entity = this.repo.create({
  ...dto,
  transaction: { id: transactionId },
});
```

### Don't Load Relations Separately

```typescript
// BAD: separate queries for related data
const user = await this.userRepo.findOne({ where: { id } });
const wallet = await this.walletRepo.findOne({ where: { user: { id: user.id } } });

// GOOD: single query with relations
const user = await this.userRepo.findOne({ where: { id }, relations: { wallet: true } });
```

### Avoid Eager Loading

Don't eagerly load relations unless truly always needed. Loading user with all relations for every query is wasteful. Use explicit `relations: { ... }` in each query to load only what's needed.

### Migrations

- **Always add migration** for entity/column changes — use `npm run migration <PascalName>` to generate
- **JavaScript files** with timestamp-based naming: `1756463340213-AddFeatureName.js`
- **Never edit a migration after merge to DEV** — add a follow-up migration instead
- **Data-only migrations** (UPDATE/INSERT/DELETE without schema changes) may be hand-written freely

**Hand-written schema migrations** must match TypeORM's deterministic constraint naming. The algorithm (from `DefaultNamingStrategy.js`):

```
<prefix>_ + sha1(tableName + '_' + columnNames.sort().join('_')).substring(0, N)
```

| Prefix | N  | Constraint type |
|--------|----|-----------------|
| `PK_`  | 27 | Primary key     |
| `FK_`  | 27 | Foreign key     |
| `UQ_`  | 27 | Unique          |
| `DF_`  | 27 | Default         |
| `REL_` | 26 | Relation        |
| `IDX_` | 26 | Index           |
| `CHK_` | 26 | Check           |

---

## Error Handling

### Correct Exception Types

| Situation | Exception |
|---|---|
| Client sent bad data | `BadRequestException` |
| Resource not found | `NotFoundException` |
| Duplicate resource | `ConflictException` |
| Authorization failure | `ForbiddenException` |
| External service down | `ServiceUnavailableException` |
| Internal processing error | `throw new Error(...)` (plain Error, **never** `InternalServerErrorException`) |
| Order can't process now | `OrderNotProcessableException` (custom) |
| Order permanently failed | `OrderFailedException` (custom) |

### Guard Clauses — Early Return

```typescript
// GOOD: flat structure
if (!withdrawal) return false;
if (withdrawal.status === 'failed') throw new OrderFailedException(...);
if (!withdrawal.txid) return false;

// BAD: nested if-else
if (!withdrawal?.txid) {
  return false;
} else if (withdrawal.status === 'failed') {
  throw new OrderFailedException(...);
}
```

Single-line guard clauses when simple:
```typescript
if (user.hasRole(UserRole.COMPLIANCE)) throw new BadRequestException('...');
if (this.networkValidated) return;
```

### Logging

Use `DfxLogger` (not the standard NestJS Logger):

```typescript
private readonly logger = new DfxLogger(MyService);

// Format: description + entity ID + colon + error
this.logger.error(`Failed to check order status for fiat output ${entity.id}:`, e);
this.logger.info(`Withdrawal awaiting approval. UTXO: ${data.withdrawalUtxo}`);
this.logger.verbose(`Sent ${amount} BTC to signer: ${txId}`);
this.logger.warn(`Retrying fetchAll for ${streamName}: ${error.message}`);
```

- `info` for business events
- `verbose` for details
- `warn` for retries
- `error` for failures
- Log severity based on error type: missing data = INFO, real error = ERROR

### Fire-and-Forget Error Handling

```typescript
// Always handle errors on non-awaited promises
this.service.doAsync()
  .catch(e => this.logger.error('Failed to process:', e));

// Use .catch(() => null) for graceful degradation
const result = await this.service.tryGet().catch(() => null);

// Use .catch(() => false) for boolean validation fallback
const isValid = await this.validateIban(iban).catch(() => false);
```

### Unnecessary Try-Catch

```typescript
// BAD: @DfxCron already handles errors
@DfxCron(CronExpression.EVERY_HOUR)
async process(): Promise<void> {
  try { ... } catch (e) { this.logger.error(e); }  // redundant
}

// GOOD
@DfxCron(CronExpression.EVERY_HOUR)
async process(): Promise<void> {
  // just do the work
}
```

### Error Aggregation for Validation

```typescript
const errors: string[] = [];
if (!valid1) errors.push('...');
if (!valid2) errors.push('...');
if (errors.length > 0) throw new Error(`Validation failed:\n${errors.join('\n')}`);
```

### Null Safety

- Always check for null before property access: `entity.recommended` might be null
- `find()` returns undefined — handle it
- Check `!= null` (not `!== 0`) when 0 is a valid value
- Watch for `[undefined]` when mapping nullable arrays
- Name fields: `name` only if firstname AND surname exist (avoid `undefined undefined`)

---

## Performance

### Filter in SQL, Not in Code

```typescript
// BAD: loading 5000 entities then filtering
const all = await this.repo.find();
return all.filter(e => e.status === Status.ACTIVE);

// GOOD: SQL filter
return this.repo.find({ where: { status: Status.ACTIVE } });
```

### Single Query over N+1

```typescript
// BAD: multiple queries
const users = await this.userRepo.find();
for (const user of users) {
  user.wallet = await this.walletRepo.findOne({ user });
}

// GOOD: single query with join
return this.userRepo.find({ relations: { wallet: true } });
```

### Use Maps for Repeated Lookups

```typescript
// BAD: O(n²) array search
for (const item of items) {
  const match = list.find(l => l.id === item.id);
}

// GOOD: create a map
const map = new Map(list.map(l => [l.id, l]));
const match = map.get(item.id);
```

### Use `update()` for Bulk Operations

```typescript
// BAD
const entities = await this.repo.find({ where: { ... } });
for (const e of entities) { e.status = Status.DONE; await this.repo.save(e); }

// GOOD: single SQL update
await this.repo.update({ oldStatus }, { status: Status.DONE });
```

### Use Parameterized Queries

```typescript
query.where('log.message LIKE :message', { message: `%${id}%` });
// not: query.where(`log.message LIKE '%${id}%'`);  // SQL injection risk
```

### Cache Repeated Fetches

- Don't fetch the same price/data twice in one method
- Use `AsyncCache`, `Map`-based in-memory cache for hot data
- Initial fetch + subscription for real-time data (not repeated polling)

### Use `Promise.all()` for Independent Operations

```typescript
// BAD: sequential when independent
const price = await this.pricingService.getPrice(asset);
const balance = await this.balanceService.getBalance(asset);

// GOOD: parallel
const [price, balance] = await Promise.all([
  this.pricingService.getPrice(asset),
  this.balanceService.getBalance(asset),
]);
```

---

## API Design

### Never Expose Entities in API — Use DtoMapper Classes

Map entities to DTOs using static mapper classes:

```typescript
// Mapper class (e.g. dto/payment-link-dto.mapper.ts)
export class PaymentLinkDtoMapper {
  static toLinkDto(paymentLink: PaymentLink): PaymentLinkDto { ... }
  static toLinkDtoList(paymentLinks: PaymentLink[]): PaymentLinkDto[] {
    return paymentLinks.map(PaymentLinkDtoMapper.toLinkDto);
  }
}

// Controller usage
@Get(':id')
async get(@Param('id') id: string): Promise<PaymentLinkDto> {
  return this.paymentLinkService.get(+id).then(PaymentLinkDtoMapper.toLinkDto);
}
```

### Don't Expose Internal Data

Never expose `apiUrl`, `apiKey`, `address`, or other sensitive internal fields in API responses.

### Decouple API Enums from Internal Enums

Create separate output enums for API responses, decoupled from internal service enums.

### `+id` for String-to-Number

```typescript
async get(@Param('id') id: string): Promise<Entity> {
  return this.service.get(+id);  // not parseInt(id)
}
```

### Deprecated Endpoints

Keep old endpoints for backward compatibility but annotate:
```typescript
@ApiOperation({ deprecated: true })
```

### `undefined` vs Empty Array

```typescript
// Return undefined when data is intentionally not loaded (permissions/config)
// Return [] when data is loaded but empty
// This lets the frontend distinguish "not shown" from "no entries yet"
return hasPermission ? await this.getData() : undefined;
```

---

## Testing

- Jest with `--silent` by default (`npm test`)
- Tests live next to the subdomain they cover
- Mock with `Object.assign(new Entity(), { ...values })` or `mockImplementation`
- Use `mockResolvedValue(value)` not `mockResolvedValue(Promise.resolve(value))`
- Entity tests go in `entity.spec.ts`, service tests in `service.spec.ts`
- Entity tests don't need module/service setup

---

## Code Cleanup

- Remove dead/unused code proactively
- Delete entire feature modules when obsolete — no code stays "for later"
- Move code to the correct domain when misplaced

---

## Anti-Patterns

| Anti-Pattern | Correct Pattern |
|---|---|
| Magic booleans: `getPrice(from, to, true)` | Use enum: `getPrice(from, to, PriceValidity.ANY)` |
| Hardcoded values: `fee = 5` | Config object or DB setting |
| `else if` after return/throw | Separate `if` blocks with early returns |
| `console.log` in production code | Use `this.logger.*` with proper levels |
| `parseInt(id)` | `+id` |
| `filter()[0]` | `find()` |
| `forEach` + push | `.map()` |
| `||` for nullish | `??` |
| `== null ? x : y` | `?? x` |
| Loading all then filtering in JS | SQL WHERE clause |
| `any` type | Proper typed interface/class |
| `string` for enum values | Typed enum |
| `@Interval(60000)` | `@DfxCron(CronExpression.EVERY_MINUTE)` |
| `eager: true` everywhere | Explicit relation loading |
| Providing service in multiple modules | Single module, import from there |
| `JSON.stringify(JSON.parse(...))` | Unnecessary — remove |
| Default parameters hiding intent | Explicit parameters |
| `forwardRef` when avoidable | Restructure module dependencies |
| Base64 encode then immediately decode | Pass the buffer directly |
| Parameter threading through 4+ layers | Context/strategy object resolved once |
| Method-forwarding without added logic | Call the sub-service directly |
| Disabling ESLint rules without reason | Fix the code instead |
