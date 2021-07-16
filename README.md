# api.fiat2defi.ch
API for fiat2defi.ch

## How to Use Migrations
### Prerequisites
* Install TypeORM CLI: `npm install -g typeorm`
* Add the `ormconfig.json` file (use configuration from `app.module.ts` with valid DB connection values)
### Create and apply a new migration
1. Do the required changes to the entity classes.
2. Recompile the code (`npm run build`) and make sure your database has all previous migrations applied.
3. Generate a migration: `typeorm migration:generate -n <migration-name> -o`
4. Verify the generated SQL code in the new file in the migration folder.
5. Update the database: `typeorm migration:run` \
If you need to revert: `typeorm migration:revert` (will revert one migration)

*Hint: Set `migrationsRun: true` in the TypeORM config to automatically apply all pending migrations on application start.*