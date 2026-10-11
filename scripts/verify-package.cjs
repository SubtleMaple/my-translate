// Compare packaged runtime to the tested out/ build, plus icon/WASM resources.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const builder = require.resolve('app-builder-lib', { paths: [require.resolve('electron-builder')] })
const asar = require(require.resolve('@electron/asar', { paths: [builder] }))
const repo = path.resolve(__dirname, '..')
// Optional output directory supports release builds alongside a running unpacked app.
const output = path.resolve(repo, process.argv[2] || 'release')
const resources = path.join(output, 'win-unpacked/resources')
const archive = path.join(resources, 'app.asar')
const metadata = require('../package.json')
const packagedMetadata = JSON.parse(asar.extractFile(archive, 'package.json').toString())
assert.equal(packagedMetadata.version, metadata.version, 'packaged application version')
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
}
const files = walk(path.join(repo, 'out'))
for (const file of files) {
  const relative = path.relative(repo, file)
  assert.ok(fs.readFileSync(file).equals(asar.extractFile(archive, relative)), relative)
}
for (const name of ['icon.ico', 'tray.ico']) {
  assert.ok(fs.readFileSync(path.join(repo,'build',name)).equals(fs.readFileSync(path.join(resources,name))), name)
}
assert.ok(fs.readFileSync(path.join(repo,'node_modules/sql.js/dist/sql-wasm.wasm')).equals(fs.readFileSync(path.join(resources,'sql-wasm.wasm'))))
const fsrsPackage = JSON.parse(asar.extractFile(archive, path.join('node_modules', 'ts-fsrs', 'package.json')).toString())
assert.equal(fsrsPackage.version, require('../package.json').dependencies['ts-fsrs'])
assert.ok(fs.readFileSync(require.resolve('ts-fsrs')).equals(asar.extractFile(archive, path.join('node_modules', 'ts-fsrs', fsrsPackage.main))))
const installer = path.join(output, 'My Translate-Setup-' + metadata.version + '.exe')
console.log(JSON.stringify({ appVersion: packagedMetadata.version, runtimeFilesMatched: files.length, resourcesMatched: 3, fsrsVersion: fsrsPackage.version, installer, bytes: fs.statSync(installer).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex') }, null, 2))
