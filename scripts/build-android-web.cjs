const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }))
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const serviceDir = 'android/app/src/main/assets/service'
async function main() {
  fs.mkdirSync(serviceDir, { recursive: true })
  const aliases = {
    'src/main/db/database.ts': 'src/android/database.ts',
    'src/main/db/persist.ts': 'src/android/database.ts',
    'src/main/settings.ts': 'src/android/settings.ts',
    'src/main/window.ts': 'src/android/host.ts',
    'src/main/tray.ts': 'src/android/host.ts',
    'src/main/services/vocabExportService.ts': 'src/android/exporter.ts'
  }
  for (const legacy of [false, true]) await build({ entryPoints: ['src/android/service.ts'], outfile: `${serviceDir}/${legacy ? 'legacy' : 'service'}.js`, bundle: true, platform: 'browser', format: 'iife', target: 'chrome80',
    define: { __APP_VERSION__: JSON.stringify(require('../package.json').version) },
    plugins: [{ name: 'android-platform', setup(b) {
      if (legacy) b.onResolve({ filter: /^sql\.js$/ }, () => ({ path: require.resolve('sql.js/dist/sql-asm.js') }))
      b.onResolve({ filter: /^(electron|node:crypto|node:path)$/ }, ({ path: name }) => ({ path: path.resolve(name === 'node:crypto' ? 'src/android/crypto.ts' : 'src/android/host.ts') }))
      b.onResolve({ filter: /^\./ }, args => {
        const absolute = path.resolve(args.resolveDir, args.path) + (path.extname(args.path) ? '' : '.ts')
        const replacement = aliases[path.relative(process.cwd(), absolute).replaceAll('\\', '/')]
        if (replacement) return { path: path.resolve(replacement) }
      })
      // sql.js browser distribution contains dead Node branches. They must remain unreachable.
      b.onResolve({ filter: /^(node:)?(fs|path|crypto)$/ }, () => ({ path: 'node-unavailable', namespace: 'android' }))
      b.onLoad({ filter: /.*/, namespace: 'android' }, () => ({ contents: 'throw Error("Node runtime is unavailable on Android")' }))
    } }]
  })
  fs.copyFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'), `${serviceDir}/sql-wasm.wasm`)
  fs.writeFileSync(`${serviceDir}/index.html`, `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'; frame-src 'none'"></head><body><script src="service.js"></script></body></html>`)
  fs.writeFileSync(`${serviceDir}/legacy.html`, `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'"></head><body><script src="legacy.js"></script></body></html>`)
  const result = spawnSync(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build', '--config', 'android/vite.config.ts'], { stdio: 'inherit' })
  if (result.status) process.exit(result.status)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
