// Build the TS evaluation in memory with the same esbuild toolchain as the test suite.
const { buildSync } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }))
const { spawnSync } = require('node:child_process')
const { outputFiles } = buildSync({ entryPoints: ['scripts/evaluate-corpus.ts'], platform: 'node', bundle: true, format: 'cjs', write: false })
const result = spawnSync(process.execPath, ['-'], { input: outputFiles[0].contents, stdio: ['pipe', 'inherit', 'inherit'] })
process.exitCode = result.status ?? 1
