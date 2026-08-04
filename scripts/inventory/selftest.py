#!/usr/bin/env python3
"""Self-test for the inventory chain against a small fixture.

The failures this pipeline has actually produced were all silent: a renamed output key left
every measurement unmatched and reported "0 of 444 measurable" instead of failing; two steps
shared a file name and one overwrote the other's input; a filter keyed on fields that were
never written matched nothing. None of them crashes — they produce a complete document full of
zeroes, or one carrying rows that should not be in it.

So this checks the contracts between the steps, not the numbers of any particular commit:
every select category is recognised, writes and locks are classified as writes, and a newly
appeared write site does not reach the published document.

Needs no `dist/` and no database. Run it directly: `python3 scripts/inventory/selftest.py`.
"""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import classify

FAILURES = []


def check(name, got, want):
    if got == want:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
        FAILURES.append(name)


CONTROLLER = """\
import { Controller, Get, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation } from '@nestjs/swagger';

@Controller('widget')
export class WidgetController {
  constructor(private readonly service: WidgetService) {}

  @Get('list')
  @UseGuards(
    AuthGuard(),
  )
  async listWidgets(): Promise<Widget[]> {
    return this.service.all();
  }

  @Get('projected')
  async projectedWidgets(): Promise<Widget[]> {
    return this.service.viaProjectionHelper([]);
  }

  @Get('named')
  async namedWidgets(): Promise<number> {
    return this.service.namedColumns();
  }

  @Get('counted')
  async countedWidgets(): Promise<number> {
    return this.service.countOnly();
  }

  @Get('whole')
  async wholeWidgets(): Promise<Widget[]> {
    return this.service.noSelect();
  }

  @Post('sync')
  @ApiExcludeEndpoint()
  @ApiOperation({ description: 'takes a (parenthesised) note', deprecated: true })
  async syncWidgets(): Promise<void> {
    return this.service.sync();
  }
}
"""

ENTITY = """\
import { Entity, Column } from 'typeorm';

@Entity()
export class Widget {
  @Column()
  name: string;
}
"""

# One site per select category, plus the three kinds that must be classified as writes.
SERVICE = """\
import { Injectable } from '@nestjs/common';

@Injectable()
export class WidgetService {
  constructor(@InjectRepository(Widget) private readonly widgetRepo: Repository<Widget>) {}

  async all(): Promise<Widget[]> {
    return this.widgetRepo.find({ relations: { owner: true } });
  }

  async fieldList(): Promise<Widget[]> {
    return this.widgetRepo.createQueryBuilder('w').select(['w.id', 'w.name']).getMany();
  }

  async viaProjectionHelper(fields: ReadonlyArray<string>): Promise<Widget[]> {
    return WIDGET_PROJECTION.apply(this.widgetRepo.createQueryBuilder('w'), fields).getMany();
  }

  async namedColumns(): Promise<number> {
    return this.widgetRepo.createQueryBuilder('w').select('w.id').getRawOne();
  }

  async namedColumnsAcrossStatements(dailySample: boolean): Promise<unknown> {
    const bucketExpr = dailySample ? 'CAST(w.createdAt AS DATE)' : `'all'`;
    const qb = this.widgetRepo
      .createQueryBuilder('w')
      .select(bucketExpr, 'bucket')
      .addSelect('w.name', 'name');
    if (dailySample) qb.addSelect('SUM(w.amount)', 'total');
    else qb.addSelect('SUM(w.amount)', 'total');
    return qb.getRawMany();
  }

  async aliasOnly(): Promise<Widget[]> {
    return this.widgetRepo.createQueryBuilder('w').select('w').getMany();
  }

  async noSelect(): Promise<Widget[]> {
    return this.widgetRepo.createQueryBuilder('w').getMany();
  }

  async countOnly(): Promise<number> {
    return this.widgetRepo.createQueryBuilder('w').getCount();
  }

  async projectedFullJoin(): Promise<Widget[]> {
    return this.widgetRepo.createQueryBuilder('w').select(['w.id']).leftJoinAndSelect('w.owner', 'o').getMany();
  }

  async writeChain(): Promise<void> {
    await this.widgetRepo.createQueryBuilder('w').update().set({ name: 'x' }).execute();
  }

  async takeLock(): Promise<void> {
    await this.widgetRepo.query('SELECT pg_advisory_xact_lock(42)');
  }

  async rawInsert(): Promise<void> {
    await this.widgetRepo.query('INSERT INTO widget (name) VALUES ($1)', ['x']);
  }

  async longRawWrite(): Promise<void> {
    // The write keyword sits far past any fixed window - the one real raw write in this
    // repository puts its UPDATE some 1200 characters past the `.query(`.
    await this.widgetRepo.query(`
      WITH candidates AS (
        SELECT id FROM widget WHERE name IS NOT NULL AND id > 0 AND id < 1000000
      ), filtered AS (
        SELECT id FROM candidates WHERE id % 2 = 0
      ), padding_one AS (
        SELECT id FROM filtered WHERE id NOT IN (SELECT id FROM candidates WHERE id < 0)
      ), padding_two AS (
        SELECT id FROM padding_one WHERE id NOT IN (SELECT id FROM filtered WHERE id < 0)
      ), padding_three AS (
        SELECT id FROM padding_two WHERE id NOT IN (SELECT id FROM padding_one WHERE id < 0)
      ), padding_four AS (
        SELECT id FROM padding_three WHERE id NOT IN (SELECT id FROM padding_two WHERE id < 0)
      ), padding_five AS (
        SELECT id FROM padding_four WHERE id NOT IN (SELECT id FROM padding_three WHERE id < 0)
      )
      UPDATE widget SET name = 'x' WHERE id IN (SELECT id FROM padding_five)
    `);
  }

  async rawRead(): Promise<unknown> {
    return this.widgetRepo.query('SELECT name FROM widget WHERE id = $1', [1]);
  }
}
"""


def build_fixture(root):
    src = os.path.join(root, 'src')
    os.makedirs(src)
    open(os.path.join(src, 'widget.controller.ts'), 'w').write(CONTROLLER)
    open(os.path.join(src, 'widget.entity.ts'), 'w').write(ENTITY)
    open(os.path.join(src, 'widget.service.ts'), 'w').write(SERVICE)
    return src


def run_step(script, src, work):
    env = dict(os.environ, API_SRC=src, INVENTORY_WORK=work, PYTHONPATH=HERE)
    r = subprocess.run([sys.executable, os.path.join(HERE, script)],
                       capture_output=True, text=True, env=env)
    if r.returncode != 0:
        print(f"  FAIL {script} exited {r.returncode}: {r.stderr.strip()[:400]}")
        FAILURES.append(script)
    return r


def test_select_categories(src, work):
    print("select categories are all recognised")
    run_step('sites.py', src, work)
    sites = json.load(open(os.path.join(work, 'sites.json')))
    by_method = {s['method']: s for s in sites}
    check('field list', by_method['fieldList']['select'], classify.SEL_FIELD_LIST)
    check('field list via PROJECTION.apply', by_method['viaProjectionHelper']['select'],
          classify.SEL_FIELD_LIST)
    # What a narrowing query selects has to travel to the measurement, or it reports the width
    # the read path was converted away from.
    check('projection name recorded for the measurement',
          by_method['viaProjectionHelper'].get('projection'), 'WIDGET_PROJECTION')
    check('literal field list counted', by_method['fieldList'].get('select_count'), 2)
    check('named columns counted', by_method['namedColumns'].get('select_count'), 1)
    # A variable as the first argument, a later addSelect in its own statement, and the same
    # column added in both branches of an if/else: three columns, five calls, one of them
    # unmatched by a string-literal rule.
    check('columns counted across statements and branches',
          by_method['namedColumnsAcrossStatements'].get('select_count'), 3)
    check('count only marked unmeasurable', by_method['countOnly'].get('unmeasurable'), True)
    check('named columns', by_method['namedColumns']['select'], classify.SEL_NAMED_COLUMNS)
    check('alias only', by_method['aliasOnly']['select'], classify.SEL_ALIAS_ONLY)
    check('no select', by_method['noSelect']['select'], classify.SEL_NO_SELECT)
    check('count only', by_method['countOnly']['select'], classify.SEL_COUNT_ONLY)
    check('projected, full join', by_method['projectedFullJoin']['select'],
          classify.SEL_PROJECTED_FULL_JOIN)
    check('find resolves its entity', by_method['all']['entity'], 'Widget')
    check('find keeps its relations tree', by_method['all']['relations'], {'owner': True})
    # Every category the renderer looks up must be one sites.py can emit - a rename on one side
    # only would read as "zero sites of this kind" instead of failing.
    emitted = {s['select'] for s in sites if s['select']}
    check('no category outside the shared list', emitted - set(classify.SELECT_KINDS), set())
    return sites


def test_write_classification(src, sites):
    print("writes, locks and raw INSERT are classified as writes")
    classify.annotate(src, sites)
    by_method = {s['method']: s for s in sites}
    check('update chain is a write', by_method['writeChain']['write'], True)
    check('advisory lock is a write', by_method['takeLock']['write'], True)
    check('raw INSERT is a write', by_method['rawInsert']['write'], True)
    # A fixed window classified this as a read: the write keyword is far past its end.
    check('raw write past any fixed window is a write', by_method['longRawWrite']['write'], True)
    check('raw SELECT is a read', by_method['rawRead']['write'], False)
    check('raw SELECT keeps its rawkind', by_method['rawRead']['rawkind'], 'read')
    check('plain find is a read', by_method['all']['write'], False)


def test_route_table(src, work):
    print("route table survives multi-line decorators")
    run_step('make_table.py', src, work)
    run_step('fix_handlers.py', src, work)
    run_step('add_version_deprecated.py', src, work)
    rows = {(r['verb'], r['path']): r for r in json.load(open(os.path.join(work, 'table.json')))}
    listing = rows.get(('GET', '/widget/list'))
    sync = rows.get(('POST', '/widget/sync'))
    # The multi-line `@UseGuards(` is the case that used to yield `AuthGuard` as the handler.
    check('handler past a multi-line guard', listing and listing['handler'], 'listWidgets')
    check('controller resolved', listing and listing['controller'], 'WidgetController')
    check('public route not marked internal', listing and listing['internal'], False)
    check('@ApiExcludeEndpoint detected', sync and sync['internal'], True)
    # `deprecated: true` sits inside an @ApiOperation whose text contains a parenthesis.
    check('deprecated found past a parenthesised string', sync and sync['deprecated'], True)


def test_endpoint_matches_site_classification(src, work):
    """The per-endpoint view must agree with the per-site view.

    They are two independent walks over the same code, and they used to decide "does this
    narrow its columns" separately: the endpoint walk recognised only a literal `.select([`,
    so an endpoint projecting through `PROJECTION.apply(...)`, naming its columns one at a
    time, or counting was reported as loading whole rows. Nothing failed — the document simply
    said the opposite of the truth for every deliberately converted endpoint.
    """
    print("endpoint classification agrees with site classification")
    sites = json.load(open(os.path.join(work, 'sites.json')))
    # endpoint_eff.py joins on the measurement; widths are irrelevant to the category.
    json.dump([dict(s, cols=5, joins=0) for s in sites],
              open(os.path.join(work, 'sites-measured.json'), 'w'))
    run_step('endpoint_eff.py', src, work)
    eps = {(e['verb'], e['path']): e for e in
           json.load(open(os.path.join(work, 'endpoint-eff.json')))}

    def kinds(path):
        e = eps.get(('GET', path))
        return set(e['kinds']) if e else None

    check('PROJECTION.apply reaches the endpoint as projected', kinds('/widget/projected'), {'proj'})
    check('named columns reach the endpoint as projected', kinds('/widget/named'), {'proj'})
    check('count only reaches the endpoint as projected', kinds('/widget/counted'), {'proj'})
    check('no select reaches the endpoint as over-fetching', kinds('/widget/whole'), {'over'})
    # A raw write or lock is not a read and must not make the endpoint one.
    check('lock and raw write are not reads',
          classify.raw_kind_of("query('SELECT pg_advisory_xact_lock(1)')"), 'lock')
    check('raw INSERT is not a read',
          classify.raw_kind_of("query('INSERT INTO widget VALUES (1)')"), 'write')


def test_measure_reports_unresolvable_projection(work):
    """An unresolvable projection must produce an error, never a number.

    `measure.js` used to fall through to the default-query measurement when a projection could
    not be resolved — which is the very bug the projection branch exists to fix, reappearing
    silently as a full-width count with exit 0. This is also the only check here that runs
    `measure.js` at all; the rest of the self-test deliberately needs no `dist/`.
    """
    print("measure.js reports an unresolvable projection")
    repo = os.path.dirname(os.path.dirname(HERE))
    dist = os.path.join(repo, 'dist')
    # Needs a built tree, unlike the rest of this file. Skipped rather than failed without one.
    if not shutil.which('node') or not os.path.isdir(os.path.join(dist, 'src')):
        print("  skip  needs node and a built dist/ (npm run build)")
        return
    # Any module exporting a ReadProjection will do; this one is referenced by the pipeline
    # itself, so if it moves the pipeline notices too.
    holder = 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository.ts'
    if not os.path.exists(os.path.join(dist, holder.replace('.ts', '.js'))):
        print(f"  skip  {holder} not in dist/")
        return
    site = {'file': holder, 'line': 1, 'cls': 'R', 'method': None, 'call': 'createQueryBuilder',
            'kind': 'query-builder', 'entity': None, 'via': None, 'relations': None,
            'select': classify.SEL_FIELD_LIST}
    sites = [
        {**site, 'method': 'ok', 'projection': 'BUY_CRYPTO_BUY_HISTORY_PROJECTION'},
        {**site, 'method': 'gone', 'projection': 'RENAMED_PROJECTION'},
    ]
    sites_path = os.path.join(work, 'measure-sites.json')
    measured_path = os.path.join(work, 'measure-out.json')
    json.dump(sites, open(sites_path, 'w'))
    r = subprocess.run(['node', os.path.join(HERE, 'measure.js'), sites_path, measured_path,
                        os.path.join(work, 'measure-tables.json')],
                       capture_output=True, text=True, env=dict(os.environ, DIST=dist), cwd=repo)
    if not os.path.exists(measured_path):
        print(f"  FAIL measure.js wrote nothing: {r.stderr.strip()[:300]}")
        FAILURES.append('measure.js')
        return
    out = {m['method']: m for m in json.load(open(measured_path))}
    cols = out['ok'].get('cols')
    check('resolvable projection measured at its field list', isinstance(cols, int) and cols > 0, True)
    # The entity is 300+ columns wide; the projection selects a dozen. A fall-through to the
    # default-query measurement would show up here as a number in the hundreds.
    check('projection width is not the entity width', bool(cols and cols < 100), True)
    check('unresolvable projection has no column count', out['gone'].get('cols'), None)
    check('unresolvable projection is reported', bool(out['gone'].get('error')), True)


def test_drift_excludes_writes(src, root, work):
    """A newly appeared write site must not reach the published document.

    This is the regression that motivated the shared classification: apply_drift.py filtered on
    `write`/`rawkind`, which live only in the renderer's memory and are absent from
    sites-measured.json — so the filter matched nothing.
    """
    print("apply_drift keeps write sites out of the document")
    sites = json.load(open(os.path.join(work, 'sites.json')))
    measured = [dict(s, cols=7, joins=0) for s in sites]

    gen = os.path.join(work, 'gen')
    os.makedirs(os.path.join(gen, 'old'), exist_ok=True)
    os.makedirs(os.path.join(gen, 'new'), exist_ok=True)
    # The old run carries an unrelated site only; the new one has found the fixture. Every
    # fixture site is therefore "new" and has to pass the filter.
    unrelated = [{'file': 'src/unrelated.service.ts', 'line': 99, 'cls': 'UnrelatedService',
                  'method': 'load', 'call': 'find', 'kind': 'find', 'entity': 'Unrelated',
                  'via': 'repo', 'relations': None, 'select': None, 'cols': 3, 'joins': 0}]
    json.dump(unrelated, open(os.path.join(gen, 'old', 'sites-measured.json'), 'w'))
    json.dump(measured, open(os.path.join(gen, 'new', 'sites-measured.json'), 'w'))

    pub = ("# Database load sites\n\nEvery place in the code that reads from the database.\n\n"
           "| Columns | Joins | Mechanism | Entity | Location | Method |\n"
           "| ------: | ----: | --------- | ------ | -------- | ------ |\n"
           "| 1 | 0 | find | `Other` | `other.service.ts:1` | `OtherService.load` |\n\ntail\n")
    repo = os.path.join(work, 'pubrepo')
    os.makedirs(repo)
    open(os.path.join(repo, 'load-sites.md'), 'w').write(pub)
    git = ['git', '-C', repo]
    subprocess.run(git + ['init', '-q'], check=True)
    subprocess.run(git + ['config', 'user.email', 'selftest@example.com'], check=True)
    subprocess.run(git + ['config', 'user.name', 'selftest'], check=True)
    subprocess.run(git + ['config', 'commit.gpgsign', 'false'], check=True)
    subprocess.run(git + ['add', 'load-sites.md'], check=True)
    subprocess.run(git + ['commit', '-q', '-m', 'published'], check=True)

    out = os.path.join(work, 'drifted.md')
    env = dict(os.environ, API_SRC=src, INVENTORY_WORK=work, INVENTORY_REPO=repo, PYTHONPATH=HERE)
    r = subprocess.run([sys.executable, os.path.join(HERE, 'apply_drift.py'),
                        'HEAD', 'load-sites.md', out],
                       capture_output=True, text=True, env=env)
    if r.returncode != 0:
        print(f"  FAIL apply_drift.py exited {r.returncode}: {r.stderr.strip()[:400]}")
        FAILURES.append('apply_drift.py')
        return
    body = open(out).read()
    check('write chain absent', 'writeChain' in body, False)
    check('advisory lock absent', 'takeLock' in body, False)
    check('raw INSERT absent', 'rawInsert' in body, False)
    check('genuine read present', 'rawRead' in body, True)
    check('projection present', 'fieldList' in body, True)
    check('published row kept', 'OtherService.load' in body, True)


def test_missing_ref_is_reported(src, work):
    """A bad git ref must say so, not fail on an empty string somewhere downstream."""
    print("apply_drift reports a bad ref instead of crashing")
    env = dict(os.environ, API_SRC=src, INVENTORY_WORK=work,
               INVENTORY_REPO=os.path.join(work, 'pubrepo'), PYTHONPATH=HERE)
    r = subprocess.run([sys.executable, os.path.join(HERE, 'apply_drift.py'),
                        'no-such-ref', 'load-sites.md', os.path.join(work, 'x.md')],
                       capture_output=True, text=True, env=env)
    check('non-zero exit', r.returncode != 0, True)
    check('names the failing ref', 'no-such-ref' in r.stderr, True)
    check('no traceback', 'Traceback' in r.stderr, False)


def main():
    root = tempfile.mkdtemp(prefix='inventory-selftest-')
    try:
        src = build_fixture(root)
        work = os.path.join(root, 'work')
        os.makedirs(work)
        sites = test_select_categories(src, work)
        test_write_classification(src, sites)
        test_route_table(src, work)
        test_endpoint_matches_site_classification(src, work)
        test_measure_reports_unresolvable_projection(work)
        test_drift_excludes_writes(src, root, work)
        test_missing_ref_is_reported(src, work)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == '__main__':
    sys.exit(main())
