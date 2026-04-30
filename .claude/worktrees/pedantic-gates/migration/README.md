## How to Use Migrations

### Prerequisites

- Add the `dev-data-source.ts` file (use configuration from `app.module.ts` with valid DB connection values)

### Create and apply a new migration

1. Do the required changes to the entity classes.
2. Recompile the code (`npm run build`) and make sure your database has all previous migrations applied.
3. Generate a migration: `npm run migration <migration-name>`
4. Verify the generated SQL code in the new file in the migration folder.
5. Update the database: `typeorm migration:run` \
   If you need to revert: `typeorm migration:revert` (will revert one migration)

_Hint: Set `migrationsRun: true` in the TypeORM config to automatically apply all pending migrations on application start._
