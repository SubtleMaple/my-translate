// Bundle the actual source into a disposable directory; no extra test dependency.
const { buildSync } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }))
const { readdirSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const target = join(tmpdir(), 'opencode', 'reading-flow')
mkdirSync(target, { recursive: true })
const outputs = readdirSync(__dirname).filter((name) => name.endsWith('.test.ts')).map((name) => {
  const outfile = join(target, name.replace(/\.ts$/, '.cjs'))
  buildSync({ entryPoints: [join(__dirname, name)], outfile, bundle: true, platform: 'node', format: 'cjs', tsconfig: resolve('tsconfig.web.json') })
  return outfile
})
const result = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
