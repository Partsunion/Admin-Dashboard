import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const loadPackage = createRequire(import.meta.url);
const micromatch = loadPackage('micromatch');
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const resolveFork = parentName => {
  const parentFile = loadPackage.resolve(parentName, { paths: [projectRoot] });
  const forkFile = loadPackage.resolve('braces', { paths: [path.dirname(parentFile)] });
  return {
    parentFile,
    forkFile,
    braces: loadPackage(forkFile),
    metadata: loadPackage(path.resolve(path.dirname(forkFile), 'package.json')),
  };
};

const micromatchFork = resolveFork('micromatch');
const chokidarFork = resolveFork('chokidar');
const nestedBrace = depth => '{'.repeat(depth) + 'a,b' + '}'.repeat(depth);
const nestedParen = depth => '('.repeat(depth) + 'x' + ')'.repeat(depth);
const guarded = /Pattern nesting depth exceeds maximum of 100|AST node depth exceeds maximum of 202|Cyclic AST nodes are not supported/;

test('lockfile routes every top-level and nested braces entry to the shared fork', () => {
  const lock = JSON.parse(readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const topLevelEntry = lock.packages['node_modules/braces'];
  const nestedEntries = Object.entries(lock.packages)
    .filter(([packagePath]) => packagePath.endsWith('/node_modules/braces'));
  const bracesEntries = [
    ...(topLevelEntry ? [['node_modules/braces', topLevelEntry]] : []),
    ...nestedEntries,
  ];
  const forkEntry = lock.packages['vendor/partsunion-braces'];

  assert.ok(bracesEntries.length >= 1, 'missing locked braces entries');
  for (const [packagePath, entry] of bracesEntries) {
    assert.equal(entry.link, true, `${packagePath} must be a local link`);
    assert.equal(entry.resolved, 'vendor/partsunion-braces', `${packagePath} must share the vendored fork`);
  }

  assert.equal(forkEntry.name, '@partsunion/braces');
  assert.equal(forkEntry.version, '3.0.3-partsunion.1');
  assert.equal(path.resolve(micromatchFork.forkFile), path.resolve(chokidarFork.forkFile));
  assert.equal(path.resolve(micromatchFork.forkFile), path.resolve(projectRoot, 'vendor/partsunion-braces/index.js'));
});

test('the installed scoped fork serves both vulnerable dependency paths', () => {
  for (const resolved of [micromatchFork, chokidarFork]) {
    assert.equal(resolved.metadata.name, '@partsunion/braces');
    assert.equal(resolved.metadata.version, '3.0.3-partsunion.1');
    assert.equal(path.basename(resolved.forkFile), 'index.js');
  }
});

test('public string APIs guard deeply nested patterns under a reduced stack', () => {
  const childScript = String.raw`
    const path = require('node:path');
    const micromatchFile = require.resolve('micromatch', { paths: [process.cwd()] });
    const braces = require(require.resolve('braces', { paths: [path.dirname(micromatchFile)] }));
    const nestedBrace = depth => '{'.repeat(depth) + 'a,b' + '}'.repeat(depth);
    const nestedParen = depth => '('.repeat(depth) + 'x' + ')'.repeat(depth);
    for (const method of ['parse', 'compile', 'expand', 'stringify']) {
      for (const pattern of [nestedBrace(3500), nestedParen(3500)]) {
        try {
          braces[method](pattern);
          process.exitCode = 2;
          process.stderr.write(method + ' accepted excessive nesting\n');
        } catch (error) {
          if (!(error instanceof RangeError) || error.message !== 'Pattern nesting depth exceeds maximum of 100') {
            process.exitCode = 3;
            process.stderr.write(error.stack + '\n');
          }
        }
      }
    }
  `;
  const child = spawnSync(process.execPath, ['--stack_size=512', '-e', childScript], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 3000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(micromatchFork.braces.parse(nestedBrace(100)).type, 'root');
  assert.equal(micromatchFork.braces.parse(nestedParen(100)).type, 'root');
});

test('public AST APIs reject caller supplied nested brace and parenthesis trees', () => {
  for (const method of ['compile', 'expand', 'stringify']) {
    for (const type of ['brace', 'paren']) {
      let ast = { type: 'text', value: 'x' };
      for (let depth = 0; depth < 101; depth += 1) ast = { type, nodes: [ast] };
      assert.throws(() => micromatchFork.braces[method](ast), guarded, `${method}/${type}`);
    }
  }
});

test('compiling a close-node AST does not disclose pattern content on stdout', () => {
  const childScript = String.raw`
    const path = require('node:path');
    const micromatchFile = require.resolve('micromatch', { paths: [process.cwd()] });
    const braces = require(require.resolve('braces', { paths: [path.dirname(micromatchFile)] }));
    const result = braces.compile({ type: 'text', isClose: true, value: 'private-pattern-sentinel' });
    if (result !== 'private-pattern-sentinel') process.exitCode = 2;
  `;
  const child = spawnSync(process.execPath, ['-e', childScript], {
    cwd: projectRoot, encoding: 'utf8', timeout: 3000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
});

test('public AST APIs bound arbitrary node depth and reject node cycles in isolated children', () => {
  const childScript = String.raw`
    const path = require('node:path');
    const micromatchFile = require.resolve('micromatch', { paths: [process.cwd()] });
    const braces = require(require.resolve('braces', { paths: [path.dirname(micromatchFile)] }));
    const [method, kind] = process.argv.slice(1);
    let ast;
    if (kind === 'deep') {
      ast = { type: 'root', nodes: [] };
      for (let depth = 0; depth < 3500; depth += 1) {
        ast = { type: depth % 2 === 0 ? 'root' : 'text', nodes: [ast] };
      }
    } else {
      ast = { type: 'root', nodes: [] };
      ast.nodes.push(ast);
    }
    try {
      braces[method](ast);
      process.exitCode = 2;
      process.stderr.write('AST guard accepted an unsafe graph\n');
    } catch (error) {
      const expected = kind === 'deep'
        ? /AST node depth exceeds maximum of 202/
        : /Cyclic AST nodes are not supported/;
      if (!(error instanceof RangeError) || !expected.test(error.message)) {
        process.exitCode = 3;
        process.stderr.write(error.stack + '\n');
      }
    }
  `;

  for (const method of ['compile', 'expand', 'stringify']) {
    for (const kind of ['deep', 'cycle']) {
      const child = spawnSync(process.execPath, ['--stack_size=512', '-e', childScript, method, kind], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 3000,
      });
      assert.ifError(child.error);
      assert.equal(child.status, 0, `${method}/${kind}: ${child.stderr || child.stdout}`);
    }
  }
});

test('brace expansion compatibility remains intact through installed consumers', async () => {
  assert.deepEqual(micromatch(['file-a.ts', 'file-b.ts', 'other.ts'], 'file-{a,b}.ts'), ['file-a.ts', 'file-b.ts']);
  assert.deepEqual(micromatchFork.braces.expand('{a,b}'), ['a', 'b']);
  assert.equal(micromatchFork.braces.compile('{a,b}'), '(a|b)');
  assert.equal(micromatchFork.braces.stringify(micromatchFork.braces.parse('{a,b}')), '{a,b}');
  assert.deepEqual(micromatchFork.braces.expand('item-{1..3}'), ['item-1', 'item-2', 'item-3']);
  const watcher = loadPackage('chokidar').watch('file-{a,b}.ts', { persistent: false, ignoreInitial: true });
  await watcher.close();
});
