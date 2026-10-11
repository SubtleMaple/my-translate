// Bundle the actual source into a disposable directory; no extra test dependency.
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }))
const { readdirSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const target = join(tmpdir(), 'opencode', 'reading-flow')
mkdirSync(target, { recursive: true })
async function main() {
const outputs = await Promise.all(readdirSync(__dirname).filter((name) => name.endsWith('.test.ts')).map(async (name) => {
  const outfile = join(target, name.replace(/\.ts$/, '.cjs'))
  await build({ entryPoints: [join(__dirname, name)], outfile, bundle: true, platform: 'node', format: 'cjs', tsconfig: resolve('tsconfig.web.json'), plugins: [{ name: 'node-test-runtime', setup(b) {
    b.onResolve({ filter: /^sql\.js$/ }, () => ({ path: require.resolve('sql.js'), external: true }))
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test-electron' }))
    b.onLoad({ filter: /.*/, namespace: 'test-electron' }, () => ({ contents: `export const app = { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => { if (!process.env.MY_TRANSLATE_TEST_PROFILE) throw Error('Missing isolated test profile'); return process.env.MY_TRANSLATE_TEST_PROFILE } }` }))
  } }] })
  return outfile
}))
const result = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
}
main().catch(e => { console.error(e); process.exitCode = 1 })
