# DFX API Coding Rules

> Derived from 3,609 review comments, 274 commits, and 129 review bodies by David (davidleomay) across 2,300 PRs in DFXswiss/api (2021-2026).

---

## 1. General Principles

- **Clarity over cleverness** -- readable code beats short but obscure expressions
- **Consistency** -- same patterns everywhere (naming, enum style, await handling)
- **Minimal changes** -- use existing Util methods, don't reinvent the wheel
- **Right layer** -- logic belongs in entities, not services; config in Config, not scattered
- **Type safety** -- no `any`, no `string` where enums exist, always add return types
- **Performance awareness** -- filter in SQL not JS, use IDs not full entities in queries
- **Clean API** -- use DTOs, never expose entities, document with ApiProperty
- **End-to-end thinking** -- every PR must include migration, environment, service updates
- **No over-engineering** -- don't build it if the existing solution works
- **Trust DB constraints** -- don't duplicate checks the database already enforces
- **Use existing packages** -- use `@dfx.swiss/*` packages instead of duplicating logic

---

## 2. Naming Conventions

### 2.1 General Rules

- **camelCase everywhere**: variables, config keys, URL routes, entity fields
- **camelCase for abbreviations**: `getUserByKycCode` not `getUserByKYCCode`, `dfiOrders` not `DFIOrders`
- **American English spelling**: `blankCenter` not `blankCentre`
- **Plural for collections**: `buys: Buy[]` not `buy: Buy[]`, `blockedIbans` not `blockedIban`
- **Boolean flags: positive naming**: `safetyModeActive` not `safetyModuleInactive`
- **Short, descriptive names -- no redundant prefixes**: `uid` not `transactionRequestUid`, `balances` not `assetBalances`, `txId` not `transactionId`
- **Variable names must precisely reflect the data**: `priceChf` not `amountChf` for a price, `valueChf` not `valuationChf`

### 2.2 Methods

- **Methods are verbs**: `logExists()`, `startNextStep()`, `cancelPayment()`
- **Must describe what they do, not the implementation**: `sendAutoResponses` not `sendAutoTemplates`
- **Boolean getters use `is`/`has`**: `isValid()`, `hasRole()`
- **Invert negative names**: `isDfxUser` not `isExternalUser`
- **No method-forwarding without logic**: if a service method only delegates to a sub-service without adding logic, remove it

### 2.2a Service Classes

- **Name services by function**: `KycSchedulerService` not generic `KycService` if it only handles scheduling
- **Suffix reflects responsibility**: `*SchedulerService`, `*NotificationService`, `*ValidationService`

### 2.3 Enums

- **Keys: UPPER_SNAKE_CASE**
- **Values: PascalCase strings**: `BITCOIN = 'Bitcoin'`, `CREATED = 'Created'`
- **Never**: `INVOICE = 'INVOICE'` or `active = 'active'`
- **Error enums use Mismatch pattern**: `CardNameMismatch` not `CARD_NAME_NOT_MATCHING`
- **Reuse existing enum values**: check if an existing AML error / quote error / status fits before creating a new one

### 2.4 Files

- **Entity files**: `*.entity.ts` (not just `*.ts`)
- **Enum files**: `*.enum.ts`
- **No custom naming for TypeORM indexes**: `@Index((user: User) => [user.address, user.blockchain], { unique: true })`

### 2.5 DTOs

- **PascalCase for class names**: `DbQueryDto` not `dbQueryDto`
- **Name must reflect purpose**: `GetBuyPaymentInfoDto` not `CreateBuyPaymentInfoDto` if it's a getter

### 2.6 Cache Keys

- **Descriptive cache keys**: `user-${userData.id}` not just `${userData.id}` (avoids ID conflicts across entity types)
- **Named caches**: `blockchainFeeCache` not `cache`, `feeCache` not `arrayCache`
- **Include all variable parameters**: use `JSON.stringify(request)` as cache key when relations/filters vary

### 2.7 Generated Files

- **Consistent naming pattern**: `YYYYMMDD-Type-X-EntityId-HHMMSS` (e.g. `20250402-NameCheck-0-311124-163302.pdf`)

---

## 3. Code Style

### 3.1 Prefer Compact Code

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

### 3.2 Nullish Operators

```typescript
// Use ?? not ||
value ?? defaultValue    // not: value || defaultValue

// Use ??= for default assignment
dto.blockchain ??= Blockchain.DEFICHAIN;
// not: if (!dto.blockchain) dto.blockchain = Blockchain.DEFICHAIN;

// Use ?. for optional chaining
if (!users?.length)      // not: if (!users || users.length === 0)
```

### 3.3 Math.max / Math.min over Ternary

```typescript
// BAD
const amount = availableAmount > 0 ? availableAmount : 0;

// GOOD
const amount = Math.max(availableAmount, 0);
```

### 3.4 Array Methods

```typescript
// Use .map() not for-loop + push
return assets.map(this.entityToDto);

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

### 3.5 Destructuring

```typescript
// Use destructuring
const { k1, signature, key } = signupDto;
const [field, select] = entry.split('-');
for (const [blockchain, assets] of map.entries()) { ... }
```

### 3.6 .then() for Mapping Chains

```typescript
// Preferred syntax for service-to-DTO mapping
return this.bankService.getAllBanks().then(BankDtoMapper.entitiesToDto);
```

### 3.7 Strict Equality

Always `===`, never `==`.

### 3.8 Rounding

```typescript
// Always round divisions -- JS is bad with floating-point
Util.round(value / divisor, 2);
```

### 3.9 Use Existing Util Methods

```typescript
Util.round()          Util.sumObjValue()     Util.avg()
Util.daysBefore()     Util.daysAfter()       Util.daysDiff()
Util.groupBy()        Util.randomString()    Util.trim
Util.removeNullFields()                      Util.doInBatches()
```

Never reinvent what Util already provides.

### 3.10 Use Config Patterns

```typescript
// Use Config.formats for regex checks
Config.formats.bankUsage.test(key);  // not: key.length === 14 && key.substring(4, 5) === '-'
Config.formats.address.test(address); // not: CryptoService.isBlockchainAddress(key)

// Use Config.xxx not GetConfig().xxx
Config.scrypt;  // not: GetConfig().scrypt

// Use factors not percentages internally
0.012  // not: 1.2%
```

### 3.11 Complex Expressions -- Split into Variables

```typescript
// BAD: nested ternary soup
return a ? (b ? x : y) : (c ? z : w);

// GOOD: named intermediates
const percentFeeAmount = ...;
const feeAmount = ...;
return Math.max(percentFeeAmount, feeAmount);
```

### 3.12 Section Comments

```typescript
// --- AUTH METHODS --- //
// --- HELPER METHODS --- //
//*** NETWORK VALIDATION ***//
```

### 3.13 Comments Rules

- **English only**: no German comments in code
- **Remove stale comments**: `// (only await UTXO)` if no longer accurate
- **Remove commented-out code**: dead code must be deleted
- **TODOs must be resolved before merge**
- **Currency hints on numeric config**: `maxBlockchainFee = 50; // CHF`
- **No AI-generated comments**: especially not in other languages

---

## 4. Architecture

### 4.1 Domain-Driven Structure

```
src/subdomains/{core|supporting|generic}/{domain}/
  {domain}.entity.ts
  {domain}.repository.ts
  {domain}.service.ts
  {domain}.controller.ts
  dto/
    create-{domain}.dto.ts
    update-{domain}.dto.ts
  {domain}.module.ts
```

Entities, DTOs, services stay in their domain. Move code to the correct domain, never duplicate.

### 4.2 Logic Belongs in Entities

```typescript
// GOOD: entity method for business logic
class UserData extends IEntity {
  get tradingLimit(): TradingLimit { ... }
  complete(): this { this.status = ...; return this; }
  isDataComplete(): boolean { ... }
}

// BAD: business logic in service
class UserService {
  getTradingLimit(userData: UserData): TradingLimit { ... }
}
```

Entities carry computed properties, state transitions (`complete()`, `txReceived()`), and validation. Use fluent pattern (`return this`).

### 4.3 Services vs Controllers

- **Controllers**: thin, delegate to services, never contain business logic
- **Services**: orchestrate business logic, call repositories
- **Repositories**: data access only, extend `BaseRepository<T>`

### 4.4 Module Structure

- Services/repos should be provided in exactly **one** module
- Never provide the same service in multiple modules -- import from the owning module
- Do not export repositories directly -- export services
- `@Injectable()` is not needed on static helper classes

### 4.5 Composition over Inheritance

```typescript
// BAD: extending and duplicating caching
class MyClient extends EvmClient { ... }

// GOOD: composition
class MyService {
  constructor(private readonly evmClient: EvmClient) {}
}
```

### 4.6 Shared Logic -- DRY

- Extract helper methods for logic used across BuyCrypto/BuyFiat/Sell
- Use maps instead of switch/if-else chains (generates build errors for unmapped values):

```typescript
const PaymentMethodMap: { [method in PaymentMethod]: PaymentType } = { ... };
```

### 4.7 Config in DB/Config Objects, Not in Code

```typescript
// BAD: hardcoded
const countries = ['DE', 'AT', 'CH'];

// GOOD: configurable
const countries = await this.settingService.get('allowedCountries');
// or in wallet table, or Config object
```

### 4.8 No Forward Refs Unless Necessary

Remove `@Inject(forwardRef(() => ...))` when circular dependencies can be resolved. Prefer constructor injection.

### 4.9 Avoid Parameter Threading

```typescript
// BAD: passing walletName through 4+ method layers
translate(key, walletName) -> translateParams(key, walletName) -> getMailAffix(walletName) -> ...

// GOOD: resolve context once at the top
const context = this.buildTranslationContext(wallet);
translate(key, context);
```

### 4.10 Assess Filter Regression Risk

When adding a `.filter()` that affects existing data (not just new functionality), evaluate the impact on all existing consumers. A filter that removes empty lines changes spacing for ALL wallets, not just the new one.

---

## 5. TypeScript / NestJS Patterns

### 5.1 Always Add Return Types

```typescript
// BAD
async getUser(id: number) { ... }

// GOOD
async getUser(id: number): Promise<User | undefined> { ... }
```

### 5.2 Always `private readonly` for Injected Dependencies

```typescript
constructor(
  private readonly transactionService: TransactionService,
  private readonly repo: RecallRepository,
) {}
```

### 5.3 DTO Validation

```typescript
// Create DTO extends Update DTO
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

### 5.4 Swagger Documentation

- `@ApiOkResponse({ type: ResponseDto })` on endpoints
- `@ApiOperation({ deprecated: true })` on deprecated endpoints
- `@ApiExcludeEndpoint()` on admin endpoints
- `@ApiTags('Payment Link')` with space in multi-word tags

### 5.5 REST Endpoints

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
- Plain string responses are annoying -- return JSON objects

### 5.6 Cron Jobs

```typescript
@Cron(CronExpression.EVERY_MINUTE)  // not @Interval
@Lock(1800)                          // @Lock comes after @Cron
async processPayments(): Promise<void> {
  if (DisabledProcess(Process.PAYMENT)) return;
  // ...
}
```

Prefer longer intervals (15min) over aggressive polling (1min). Only use short intervals when truly needed.

### 5.7 Await Discipline

```typescript
// Always await async operations
await this.repo.save(entity);

// Use void for fire-and-forget (must handle errors)
void this.notificationService.send(msg).catch(e => this.logger.error('...', e));

// Don't await before return
return this.service.getData();  // not: return await this.service.getData();
```

### 5.8 No `any` Type

```typescript
// BAD
async process(data: any): Promise<any> { ... }

// GOOD
async process(data: OrderData): Promise<Transaction> { ... }
```

### 5.9 Visibility

- `protected` for abstract method implementations (not public)
- `private` getter for computed values on services
- Only make methods public when other modules need them

---

## 6. Database / TypeORM

### 6.1 Entity Patterns

```typescript
@Entity()
@Index((r: Recall) => [r.bankTx, r.checkoutTx, r.sequence], { unique: true })
export class Recall extends IEntity {
  @ManyToOne(() => BankTx)
  bankTx: BankTx;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ length: 'MAX' })
  comment: string;

  @Column({ default: false })   // booleans: default, not nullable
  synced: boolean;

  @Column({ nullable: false, default: 0 })  // numbers: explicit constraints
  amount: number;
}
```

**Rules:**
- Relations via lambda: `@ManyToOne(() => BankTx)` -- never strings
- `nullable: false` explicit where needed
- `type: 'datetime2'` for date columns
- `type: 'simple-json'` for structured JSON data (not manual `JSON.parse`/`JSON.stringify`)
- `eager: false` is the default -- don't annotate it
- Use `eager: true` sparingly -- explicit relation loading is preferred
- Column length always specified
- Boolean columns: `default: false` (no nullable)
- `unique: true` on uniqueId columns
- No custom index names

### 6.2 Queries

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

### 6.3 Relation Creation

```typescript
// Create with ID reference
const entity = this.repo.create({
  ...dto,
  transaction: { id: transactionId },
});
```

### 6.4 Avoid Eager Loading Problems

Don't eagerly load relations unless truly always needed. Loading user with all relations for every file is wasteful. Ignore eager relations when not needed.

### 6.4a Trust DB Constraints

```typescript
// BAD: manual existence check before insert when unique constraint exists
const existing = await this.repo.findOne({ where: { uniqueField } });
if (existing) throw new ConflictException('Already exists');
await this.repo.save(entity);

// GOOD: let the DB handle it as fallback
await this.repo.save(entity);  // unique constraint will throw if duplicate
```

### 6.5 Don't Load Relations Separately

```typescript
// BAD: "probably counterproductive"
const user = await this.userRepo.findOne(id);
const wallet = await this.walletRepo.findOne({ user });

// GOOD: single query with relations
const user = await this.userRepo.findOne({ where: { id }, relations: { wallet: true } });
```

### 6.6 Migrations

- **Always add migration** for entity/column changes
- **JavaScript files** with JSDoc typehints
- **Never edit a migration after merge to DEV**
- Timestamp-based naming: `1756463340213-AddFeatureName.js`

---

## 7. Error Handling

### 7.1 Correct Exception Types

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

### 7.2 Guard Clauses -- Early Return

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

### 7.3 Logging

```typescript
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

### 7.4 Fire-and-Forget Error Handling

```typescript
// Always handle errors on non-awaited promises
this.service.doAsync()
  .catch(e => this.logger.error('Failed to process:', e));

// Or use .catch(() => null) for graceful degradation
const result = await this.service.tryGet().catch(() => null);

// Use .catch(() => false) for boolean validation fallback
const isValid = await this.validateIban(iban).catch(() => false);
```

### 7.5 Unnecessary Try-Catch

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

### 7.6 Error Aggregation for Validation

```typescript
const errors: string[] = [];
if (!valid1) errors.push('...');
if (!valid2) errors.push('...');
if (errors.length > 0) throw new Error(`Validation failed:\n${errors.join('\n')}`);
```

### 7.7 Null Safety

- Always check for null before property access: `entity.recommended` might be null
- `find()` returns undefined -- handle it
- Check `!= null` (not `!== 0`) when 0 is a valid value
- Watch for `[undefined]` when mapping nullable arrays
- Name fields: `name` only if firstname AND surname exist (avoid `undefined undefined`)

---

## 8. Performance

### 8.1 Filter in SQL, Not in Code

```typescript
// BAD: loading 5000 entities then filtering
const all = await this.repo.find();
return all.filter(e => e.status === Status.ACTIVE);

// GOOD: SQL filter
return this.repo.find({ where: { status: Status.ACTIVE } });
```

### 8.2 Single Query over N+1

```typescript
// BAD: multiple queries
const users = await this.userRepo.find();
for (const user of users) {
  user.wallet = await this.walletRepo.findOne({ user });
}

// GOOD: single query with join
return this.userRepo.find({ relations: { wallet: true } });
```

### 8.3 Use SQL for Aggregation

```typescript
// BAD: O(n^2) array search
for (const item of items) {
  const match = list.find(l => l.id === item.id); // searched 4 times
}

// GOOD: create a map
const map = new Map(list.map(l => [l.id, l]));
const match = map.get(item.id);
```

### 8.4 Use `update()` for Bulk Operations

```typescript
// BAD
const entities = await this.repo.find({ where: { ... } });
for (const e of entities) { e.status = Status.DONE; await this.repo.save(e); }

// GOOD: single SQL update
await this.repo.update({ oldStatus }, { status: Status.DONE });
```

### 8.5 Use Parameterized Queries

```typescript
query.where('log.message LIKE :message', { message: `%${id}%` });
// not: query.where(`log.message LIKE '%${id}%'`);  // SQL injection risk
```

### 8.6 Cache Repeated Fetches

- Don't fetch the same price/data twice in one method
- Use `AsyncCache`, `Map`-based in-memory cache for hot data
- Initial fetch + subscription for real-time data (not repeated polling)

---

## 9. API Design

### 9.1 Never Expose Entities in API

```typescript
// BAD
@Get(':id')
async get(@Param('id') id: string): Promise<PaymentLink> { ... }

// GOOD
@Get(':id')
async get(@Param('id') id: string): Promise<PaymentLinkDto> {
  return this.service.get(+id).then(PaymentLinkDtoMapper.entityToDto);
}
```

### 9.2 Don't Expose Internal Data

Never expose `apiUrl`, `apiKey`, `address`, or other sensitive internal fields in API responses.

### 9.3 Decouple API Enums from Internal Enums

Create separate output enums for API responses, decoupled from internal service enums.

### 9.4 `+id` for String-to-Number

```typescript
async get(@Param('id') id: string): Promise<Entity> {
  return this.service.get(+id);  // not parseInt(id)
}
```

### 9.5 Deprecated Endpoints

Keep old endpoints for backward compatibility but annotate:
```typescript
@ApiOperation({ deprecated: true })
```

### 9.6 `undefined` vs Empty Array

```typescript
// Return undefined when data is intentionally not loaded (permissions/config)
// Return [] when data is loaded but empty
// This lets the frontend distinguish "not shown" from "no entries yet"
return hasPermission ? await this.getData() : undefined;
```

---

## 10. Testing

- Mock with `Object.assign(new Entity(), { ...values })` or `mockImplementation`
- Use `mockResolvedValue(value)` not `mockResolvedValue(Promise.resolve(value))`
- Entity tests go in `entity.spec.ts`, service tests in `service.spec.ts`
- Entity tests don't need module/service setup

---

## 11. Process

### 11.1 PR Completeness

Every PR must include:
1. **Migration** (if entity/column changes)
2. **Environment/Infrastructure updates** (Bicep, config)
3. **Service updates** (if DTOs/interfaces changed)
4. **Frontend synchronization** (if API contracts changed)

Missing any of these = changes requested.

### 11.2 Before Merge

- Fix all linter errors and warnings (never disable lint rules without justification)
- Fix formatting
- Remove all `console.log` / debug statements
- Resolve all TODO comments
- Remove merge markers

### 11.3 PR Coordination

- PRs may need to wait for dependent PRs to merge first
- Some PRs need approval from specific team members
- Check if changes need to be mirrored in related repos

### 11.4 Code Cleanup

- Remove dead/unused code proactively
- Delete entire feature modules when obsolete -- no code stays "for later"
- Move code to the correct domain when misplaced

---

## 12. Anti-Patterns (Never Do This)

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
| `@Interval(60000)` | `@Cron(CronExpression.EVERY_MINUTE)` |
| `eager: true` everywhere | Explicit relation loading |
| Providing service in multiple modules | Single module, import from there |
| `JSON.stringify(JSON.parse(...))` | Unnecessary -- remove |
| Default parameters hiding intent | Explicit parameters |
| `forwardRef` when avoidable | Restructure module dependencies |
| Base64 encode then immediately decode | Pass the buffer directly |
| Parameter threading through 4+ layers | Context/strategy object resolved once |
| Manual existence check before insert | Trust DB unique constraints |
| Method-forwarding without added logic | Call the sub-service directly |
| Disabling ESLint rules without reason | Fix the code instead |
