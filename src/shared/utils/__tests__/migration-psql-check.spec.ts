import * as fs from 'fs';
import * as path from 'path';

/**
 * Scans migration files for MSSQL-specific syntax that won't work on PostgreSQL.
 *
 * Since the PSQL migration (#3620), all new migrations must use PostgreSQL syntax.
 * This test catches common MSSQL patterns that would fail silently or break on deploy.
 */
describe('Migration PostgreSQL Compatibility', () => {
  const migrationDir = path.join(__dirname, '..', '..', '..', '..', 'migration');

  // Migrations written before the PSQL migration are exempt
  const psqlMigrationTimestamp = 1779802432879; // AddForeignKeyIndexes (last known PSQL migration)

  const mssqlPatterns: { pattern: RegExp; description: string }[] = [
    { pattern: /"dbo"\./i, description: 'MSSQL schema prefix "dbo."' },
    { pattern: /IDENTITY_INSERT/i, description: 'MSSQL IDENTITY_INSERT' },
    { pattern: /\bTOP\s+\d+/i, description: 'MSSQL TOP N (use LIMIT instead)' },
    { pattern: /\bNVARCHAR\b/i, description: 'MSSQL NVARCHAR (use VARCHAR or TEXT instead)' },
    { pattern: /\bDATETIME2\b/i, description: 'MSSQL DATETIME2 (use TIMESTAMP instead)' },
    { pattern: /\bGETDATE\s*\(\)/i, description: 'MSSQL GETDATE() (use NOW() instead)' },
    { pattern: /\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/i, description: 'MSSQL IDENTITY(1,1) (use SERIAL instead)' },
    { pattern: /\[(\w+)\]/g, description: 'MSSQL bracket quoting [column] (use "column" instead)' },
  ];

  const getMigrationFiles = (): { name: string; content: string; timestamp: number }[] => {
    if (!fs.existsSync(migrationDir)) return [];

    return fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.js') && /^\d+/.test(f))
      .map((f) => {
        const timestamp = parseInt(f.split('-')[0], 10);
        return {
          name: f,
          content: fs.readFileSync(path.join(migrationDir, f), 'utf-8'),
          timestamp,
        };
      })
      .filter((f) => f.timestamp > psqlMigrationTimestamp);
  };

  it('should not contain MSSQL syntax in new migrations', () => {
    const files = getMigrationFiles();
    const issues: string[] = [];

    for (const file of files) {
      for (const { pattern, description } of mssqlPatterns) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;

        if (pattern.test(file.content)) {
          issues.push(`  ${file.name}: ${description}`);
        }
      }
    }

    if (issues.length > 0) {
      throw new Error(
        `Found MSSQL syntax in post-PSQL migrations:\n${issues.join('\n')}\n\n` +
          `All migrations after the PSQL migration must use PostgreSQL syntax.`,
      );
    }
  });
});
