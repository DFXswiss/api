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
  @Get('list')
  @UseGuards(
    AuthGuard(),
  )
  async listWidgets(): Promise<Widget[]> {
    return this.service.all();
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

  async namedColumns(): Promise<number> {
    return this.widgetRepo.createQueryBuilder('w').select('w.id').getRawOne();
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
