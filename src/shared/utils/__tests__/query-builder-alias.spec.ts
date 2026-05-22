import * as fs from 'fs';
import * as path from 'path';

/**
 * This test scans all files containing TypeORM query builder code and verifies:
 *
 * 1. All createQueryBuilder() calls have an alias
 *    - Either via createQueryBuilder('alias')
 *    - Or via .from(table, 'alias')
 *    - Or via .update('table') pattern (update queries don't need alias)
 *
 * 2. All column references use the alias prefix (alias.column)
 *    Checked in:
 *    - String methods: select, addSelect, where, andWhere, orWhere, groupBy, addGroupBy, orderBy, addOrderBy, having
 *    - Object syntax: .orderBy({col: 'ASC'}), .where({col: val})
 *    - Array syntax: .select(['col1', 'col2'])
 *    - Join conditions: .leftJoin('rel', 'alias', 'condition')
 *    - getRawIterator selections (uses 'e' alias internally)
 *
 * Why: PostgreSQL folds unquoted identifiers to lowercase, so camelCase columns fail.
 * When you use alias.propertyName syntax, TypeORM handles the quoting automatically.
 */
describe('Query Builder Alias Enforcement', () => {
  const srcDir = path.join(__dirname, '..', '..', '..');

  const findCreateQueryBuilderWithoutAlias = (filePath: string): { line: number; content: string }[] => {
    const issues: { line: number; content: string }[] = [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find createQueryBuilder() calls without an alias argument
    const noAliasPattern = /\.createQueryBuilder\s*\(\s*\)/g;

    let match;
    while ((match = noAliasPattern.exec(content)) !== null) {
      // Check if followed by .from() with an alias (dataSource pattern)
      const afterMatch = content.substring(match.index + match[0].length, match.index + match[0].length + 300);
      if (/^\s*[\n\r]*\s*\.\s*from\s*\([^,]+,\s*[^)]+\)/.test(afterMatch)) {
        continue; // Has alias via .from(table, alias)
      }

      // Check if followed by .update() (update queries don't need alias)
      if (/^\s*[\n\r]*\s*\.\s*update\s*\(/.test(afterMatch)) {
        continue; // Update query pattern
      }

      const lineNumber = content.substring(0, match.index).split('\n').length;
      issues.push({
        line: lineNumber,
        content: lines[lineNumber - 1].trim(),
      });
    }

    return issues;
  };

  // SQL keywords and functions that don't need alias prefix
  const sqlKeywords = new Set([
    'select',
    'from',
    'where',
    'and',
    'or',
    'not',
    'in',
    'is',
    'null',
    'like',
    'between',
    'as',
    'asc',
    'desc',
    'order',
    'by',
    'group',
    'having',
    'limit',
    'offset',
    'join',
    'left',
    'right',
    'inner',
    'outer',
    'on',
    'true',
    'false',
    'case',
    'when',
    'then',
    'else',
    'end',
    'distinct',
    'exists',
    'any',
    'all',
  ]);

  const sqlFunctions = new Set([
    'sum',
    'count',
    'avg',
    'min',
    'max',
    'abs',
    'coalesce',
    'nullif',
    'cast',
    'lower',
    'upper',
    'trim',
    'concat',
    'length',
    'substring',
    'replace',
    'now',
    'current_timestamp',
    'current_date',
    'date',
    'time',
    'timestamp',
    'to_char',
    'to_number',
    'to_date',
    'extract',
    'date_trunc',
    'round',
    'floor',
    'ceil',
    'jsonb_array_elements_text',
  ]);

  /**
   * Extract all aliases defined in a query chain (main alias + joins + subqueries)
   */
  const extractAllAliases = (queryChain: string, mainAlias: string): Set<string> => {
    const aliases = new Set<string>([mainAlias]);

    // Find join aliases: .leftJoin('relation', 'alias') or .innerJoin('relation', 'alias')
    // This handles both relation joins and entity joins
    const joinPattern =
      /\.(left|inner|right)Join(?:AndSelect)?\s*\(\s*(?:['"`][^'"`]+['"`]|\w+)\s*,\s*['"`](\w+)['"`]/g;
    let joinMatch;
    while ((joinMatch = joinPattern.exec(queryChain)) !== null) {
      aliases.add(joinMatch[2]);
    }

    // Find subquery aliases: .from(Entity, 'alias')
    const fromPattern = /\.from\s*\([^,]+,\s*['"`](\w+)['"`]/g;
    let fromMatch;
    while ((fromMatch = fromPattern.exec(queryChain)) !== null) {
      aliases.add(fromMatch[1]);
    }

    // Find innerJoin with subquery that defines its own aliases
    // These subqueries have their own scope, so we add common subquery alias patterns
    const subqueryPattern = /\(\s*(?:qb|sub)\s*\)\s*=>\s*(?:qb|sub)([\s\S]*?)(?=\)\s*,\s*['"`])/g;
    let subMatch;
    while ((subMatch = subqueryPattern.exec(queryChain)) !== null) {
      const subqueryContent = subMatch[1];
      // Extract aliases from subquery .from() calls
      const subFromPattern = /\.from\s*\([^,]+,\s*['"`](\w+)['"`]/g;
      let subFromMatch;
      while ((subFromMatch = subFromPattern.exec(subqueryContent)) !== null) {
        aliases.add(subFromMatch[1]);
      }
    }

    return aliases;
  };

  /**
   * Extract result aliases from SELECT statements (used in orderBy)
   */
  const extractResultAliases = (queryChain: string): Set<string> => {
    const resultAliases = new Set<string>();

    // Match: .select('...', 'alias') or .addSelect('...', 'alias')
    const selectAliasPattern = /\.(select|addSelect)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*['"`](\w+)['"`]/g;
    let match;
    while ((match = selectAliasPattern.exec(queryChain)) !== null) {
      resultAliases.add(match[2]);
    }

    return resultAliases;
  };

  const findBareColumnReferences = (filePath: string): { line: number; content: string; column: string }[] => {
    const issues: { line: number; content: string; column: string }[] = [];
    const content = fs.readFileSync(filePath, 'utf-8');

    // Find query chains ending with any get method (excluding getQuery which is for subqueries)
    // Handle optional generic type: getRawMany<Type>()
    // Use negative lookahead to not match across multiple createQueryBuilder calls
    const rawQueryPattern =
      /\.createQueryBuilder\s*\(\s*['"`](\w+)['"`]\s*\)((?:(?!\.createQueryBuilder)[\s\S])*?)\.(getRawMany|getRawOne|getMany|getOne|getCount)\s*(?:<[^>]+>)?\s*\(/g;

    // Find all query builder aliases in the file (for correlated subquery support)
    const allQueryAliasPattern = /\.createQueryBuilder\s*\(\s*['"`](\w+)['"`]\s*\)/g;
    const allQueryAliases = new Set<string>();
    let aliasMatch;
    while ((aliasMatch = allQueryAliasPattern.exec(content)) !== null) {
      allQueryAliases.add(aliasMatch[1]);
    }

    let chainMatch;
    while ((chainMatch = rawQueryPattern.exec(content)) !== null) {
      const mainAlias = chainMatch[1];
      const queryChain = chainMatch[2];
      const chainStartIndex = chainMatch.index;

      // Get all valid aliases (main + joins + subqueries)
      // Also include all query aliases from the file for correlated subquery support
      const validAliases = extractAllAliases(queryChain, mainAlias);
      for (const alias of allQueryAliases) {
        validAliases.add(alias);
      }

      // Get result aliases (for orderBy)
      const resultAliases = extractResultAliases(queryChain);

      // Extract string arguments from query methods (excluding orderBy which can use result aliases)
      const methodPattern =
        /\.(select|addSelect|where|andWhere|orWhere|groupBy|addGroupBy|having)\s*\(\s*['"`]([^'"`]+)['"`]/g;

      let methodMatch;
      while ((methodMatch = methodPattern.exec(queryChain)) !== null) {
        const sqlFragment = methodMatch[2];

        // Skip if contains JavaScript template expression
        if (sqlFragment.includes('${')) continue;

        // Skip if contains raw SQL subquery (SELECT ... FROM)
        if (/SELECT\s+.*\s+FROM\s+/i.test(sqlFragment)) continue;

        const invalidRef = findInvalidReferenceWithAliases(sqlFragment, validAliases);

        if (invalidRef) {
          const beforeMatch = content.substring(0, chainStartIndex + methodMatch.index);
          const lineNumber = beforeMatch.split('\n').length;

          issues.push({
            line: lineNumber,
            content: sqlFragment,
            column: invalidRef,
          });
        }
      }

      // Check orderBy separately (can use result aliases)
      const orderByPattern = /\.(orderBy|addOrderBy)\s*\(\s*['"`]([^'"`]+)['"`]/g;
      let orderMatch;
      while ((orderMatch = orderByPattern.exec(queryChain)) !== null) {
        const sqlFragment = orderMatch[2];

        // Skip if contains JavaScript template expression
        if (sqlFragment.includes('${')) continue;

        // Combine table aliases and result aliases for orderBy
        const allValidAliases = new Set([...validAliases, ...resultAliases]);
        const invalidRef = findInvalidReferenceWithAliases(sqlFragment, allValidAliases);

        if (invalidRef) {
          const beforeMatch = content.substring(0, chainStartIndex + orderMatch.index);
          const lineNumber = beforeMatch.split('\n').length;

          issues.push({
            line: lineNumber,
            content: sqlFragment,
            column: invalidRef,
          });
        }
      }

      // Check object syntax: .orderBy({col: 'ASC'}), .where({col: val}), etc.
      const objectSyntaxPattern = /\.(orderBy|where|andWhere|orWhere)\s*\(\s*\{([^}]+)\}/g;
      let objMatch;
      while ((objMatch = objectSyntaxPattern.exec(queryChain)) !== null) {
        const objectContent = objMatch[2];
        // Extract keys from the object - handle both quoted and unquoted keys
        // Quoted: 'entity.id': or "entity.id":
        // Unquoted: id:
        const keyPattern = /['"`]([^'"`]+)['"`]\s*:|([a-zA-Z_][a-zA-Z0-9_.]*)\s*:/g;
        let keyMatch;
        while ((keyMatch = keyPattern.exec(objectContent)) !== null) {
          const column = keyMatch[1] || keyMatch[2]; // quoted or unquoted

          // Skip JavaScript expressions
          if (column.includes('${')) continue;

          const allValidAliases = new Set([...validAliases, ...resultAliases]);
          const invalidRef = findInvalidReferenceWithAliases(column, allValidAliases);
          if (invalidRef) {
            const beforeMatch = content.substring(0, chainStartIndex + objMatch.index);
            const lineNumber = beforeMatch.split('\n').length;
            issues.push({
              line: lineNumber,
              content: objectContent.trim(),
              column: invalidRef,
            });
            break;
          }
        }
      }

      // Check array syntax: .select(['col1', 'col2']), .addSelect(['col'])
      const arraySyntaxPattern = /\.(select|addSelect)\s*\(\s*\[([^\]]+)\]/g;
      let arrMatch;
      while ((arrMatch = arraySyntaxPattern.exec(queryChain)) !== null) {
        const arrayContent = arrMatch[2];
        // Extract string elements from array
        const elemPattern = /['"`]([^'"`]+)['"`]/g;
        let elemMatch;
        while ((elemMatch = elemPattern.exec(arrayContent)) !== null) {
          const column = elemMatch[1];
          const invalidRef = findInvalidReferenceWithAliases(column, validAliases);
          if (invalidRef) {
            const beforeMatch = content.substring(0, chainStartIndex + arrMatch.index);
            const lineNumber = beforeMatch.split('\n').length;
            issues.push({
              line: lineNumber,
              content: arrayContent.trim(),
              column: invalidRef,
            });
            break;
          }
        }
      }

      // Check join conditions: .leftJoin('rel', 'alias', 'condition'), .innerJoin(...)
      const joinConditionPattern =
        /\.(left|inner|right)Join(?:AndSelect)?\s*\(\s*(?:['"`][^'"`]+['"`]|\w+)\s*,\s*['"`]\w+['"`]\s*,\s*['"`]([^'"`]+)['"`]/g;
      let joinMatch;
      while ((joinMatch = joinConditionPattern.exec(queryChain)) !== null) {
        const condition = joinMatch[2];

        // Skip JavaScript expressions
        if (condition.includes('${')) continue;

        const invalidRef = findInvalidReferenceWithAliases(condition, validAliases);
        if (invalidRef) {
          const beforeMatch = content.substring(0, chainStartIndex + joinMatch.index);
          const lineNumber = beforeMatch.split('\n').length;
          issues.push({
            line: lineNumber,
            content: condition,
            column: invalidRef,
          });
        }
      }
    }

    // Check getRawIterator calls - they use alias 'e' internally
    const rawIteratorPattern = /\.getRawIterator\s*(?:<[^>]+>)?\s*\(\s*\d+\s*,\s*['"`]([^'"`]+)['"`]/g;
    let iterMatch;
    while ((iterMatch = rawIteratorPattern.exec(content)) !== null) {
      const selection = iterMatch[1];
      const validAliases = new Set(['e']); // getRawIterator uses 'e' as alias
      const invalidRef = findInvalidReferenceWithAliases(selection, validAliases);

      if (invalidRef) {
        const lineNumber = content.substring(0, iterMatch.index).split('\n').length;
        issues.push({
          line: lineNumber,
          content: selection,
          column: invalidRef,
        });
      }
    }

    return issues;
  };

  /**
   * Check if a SQL fragment has property references not using any valid alias.
   */
  const findInvalidReferenceWithAliases = (sqlFragment: string, validAliases: Set<string>): string | null => {
    // Skip fragments that contain raw SQL subqueries
    if (/SELECT\s+.*\s+FROM\s+/i.test(sqlFragment)) {
      return null;
    }

    // Match word.word patterns (potential property access)
    const propertyPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let propMatch;
    while ((propMatch = propertyPattern.exec(sqlFragment)) !== null) {
      const prefix = propMatch[1];
      // If the prefix is not a valid alias and not a SQL function, it's invalid
      if (!validAliases.has(prefix) && !sqlFunctions.has(prefix.toLowerCase())) {
        return propMatch[0];
      }
    }

    // Match bare identifiers (not preceded by dot, not a SQL keyword/function)
    const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let idMatch;
    while ((idMatch = identifierPattern.exec(sqlFragment)) !== null) {
      const word = idMatch[1];
      const index = idMatch.index ?? 0;

      // Skip SQL keywords and functions
      if (sqlKeywords.has(word.toLowerCase()) || sqlFunctions.has(word.toLowerCase())) continue;

      // Skip if it's a parameter placeholder :paramName
      if (sqlFragment.includes(`:${word}`)) continue;

      // Skip if it's a JavaScript template variable ${varName}
      if (sqlFragment.includes(`\${${word}}`)) continue;

      // Skip if already quoted "columnName"
      if (sqlFragment.includes(`"${word}"`)) continue;

      // Skip if it's a valid alias
      if (validAliases.has(word)) continue;

      // Check what's before and after this word
      const charBefore = index > 0 ? sqlFragment[index - 1] : '';
      const charAfter = sqlFragment[index + word.length] || '';

      // Skip if preceded by dot (it's the property part of alias.property)
      if (charBefore === '.') continue;

      // Skip if followed by dot (it's a prefix, will be caught by propertyPattern)
      if (charAfter === '.') continue;

      // Skip if followed by open paren (it's a function call)
      if (charAfter === '(') continue;

      // This is a bare identifier that should have alias prefix
      return word;
    }

    return null;
  };

  const getAllTypeScriptFiles = (dir: string): string[] => {
    const files: string[] = [];

    const walkDir = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory() && !entry.name.includes('node_modules') && !entry.name.startsWith('.')) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          // Check if file contains query builder code
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes('createQueryBuilder') || content.includes('getRawIterator')) {
            files.push(fullPath);
          }
        }
      }
    };

    walkDir(dir);
    return files;
  };

  // Unit tests for detection logic
  describe('findInvalidReferenceWithAliases', () => {
    it('should catch wrong alias prefix', () => {
      const validAliases = new Set(['ut']);
      expect(findInvalidReferenceWithAliases('lightningWallet.id', validAliases)).toBe('lightningWallet.id');
    });

    it('should catch bare column name', () => {
      const validAliases = new Set(['ut']);
      expect(findInvalidReferenceWithAliases('SUM(amount - ABS(ut.fee))', validAliases)).toBe('amount');
    });

    it('should allow correct alias prefix', () => {
      const validAliases = new Set(['ut']);
      expect(findInvalidReferenceWithAliases('ut.lightningWallet.id', validAliases)).toBeNull();
    });

    it('should allow SQL functions', () => {
      const validAliases = new Set(['ut']);
      expect(findInvalidReferenceWithAliases('SUM(ut.amount)', validAliases)).toBeNull();
    });

    it('should allow ROUND function', () => {
      const validAliases = new Set(['r']);
      expect(findInvalidReferenceWithAliases('ROUND(SUM(r.amountInChf), 0)', validAliases)).toBeNull();
    });

    it('should skip raw SQL subqueries', () => {
      const validAliases = new Set(['step']);
      const sql = `step.userDataId NOT IN (
        SELECT s2.userDataId FROM kyc_step s2
        WHERE s2.name = :approvalName
      )`;
      expect(findInvalidReferenceWithAliases(sql, validAliases)).toBeNull();
    });
  });

  it('should have all createQueryBuilder() calls with an alias', () => {
    const files = getAllTypeScriptFiles(srcDir);
    const allIssues: { file: string; issues: { line: number; content: string }[] }[] = [];

    for (const file of files) {
      const issues = findCreateQueryBuilderWithoutAlias(file);
      if (issues.length > 0) {
        allIssues.push({
          file: path.relative(srcDir, file),
          issues,
        });
      }
    }

    if (allIssues.length > 0) {
      const errorMessage = allIssues
        .map(({ file, issues }) => {
          const issueLines = issues.map((i) => `    Line ${i.line}: ${i.content}`).join('\n');
          return `\n  ${file}:\n${issueLines}`;
        })
        .join('\n');

      throw new Error(
        `Found createQueryBuilder() calls without an alias:${errorMessage}\n\n` +
          `Fix by adding an alias: createQueryBuilder('alias') instead of createQueryBuilder()`,
      );
    }
  });

  it('should use alias prefix for all column references in raw queries', () => {
    const files = getAllTypeScriptFiles(srcDir);
    const allIssues: { file: string; issues: { line: number; content: string; column: string }[] }[] = [];

    for (const file of files) {
      const issues = findBareColumnReferences(file);
      if (issues.length > 0) {
        allIssues.push({
          file: path.relative(srcDir, file),
          issues,
        });
      }
    }

    if (allIssues.length > 0) {
      const errorMessage = allIssues
        .map(({ file, issues }) => {
          const issueLines = issues.map((i) => `    Line ${i.line}: "${i.column}" in: ${i.content}`).join('\n');
          return `\n  ${file}:\n${issueLines}`;
        })
        .join('\n');

      throw new Error(
        `Found bare column references in raw queries (missing alias prefix):${errorMessage}\n\n` +
          `Fix by using alias.columnName instead of columnName`,
      );
    }
  });
});
