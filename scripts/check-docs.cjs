// 仅用 Node 内置模块：新检出无需 node_modules 或本地 docs/ 即可校验。
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const pkg = JSON.parse(read('package.json'))
const errors = []
const documents = ['AGENTS.md', 'README.md', 'CHANGELOG.md', 'android/README.md']
const required = ['README', 'CURRENT_STATE', 'ARCHITECTURE', 'BUSINESS_RULES', 'DATA_MODEL', 'DEVELOPMENT', 'TESTING_RELEASE']
const relative = file => path.relative(root, file).split(path.sep).join('/')
const content = new Map()
let links = 0
let commands = 0

function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`
    if (entry.isDirectory()) walk(file)
    else if (entry.name.endsWith('.md')) documents.push(file)
  }
}
walk('handbook')
for (const name of required) {
  if (!documents.includes(`handbook/${name}.md`)) errors.push(`缺少必需手册 handbook/${name}.md`)
}

// 手册采用 ATX 标题和行内链接；代码围栏中的示例不当作标题/链接解析。
function prose(text) {
  let fence = null
  return text.split(/\r?\n/).map(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)
    if (marker && !fence) { fence = marker[1]; return '' }
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null
      return ''
    }
    return line
  }).join('\n')
}
function anchors(text) {
  const found = new Set()
  for (const match of prose(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1].toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-')
    let slug = base, suffix = 0
    while (found.has(slug)) slug = `${base}-${++suffix}`
    found.add(slug)
  }
  return found
}
function exactPath(file) {
  let directory = root
  for (const segment of relative(file).split('/')) {
    if (!fs.readdirSync(directory).includes(segment)) return false
    directory = path.join(directory, segment)
  }
  return true
}
for (const file of documents) content.set(file, read(file))
for (const [file, text] of content) {
  const body = prose(text)
  for (const match of body.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1]
    if (/^(https?:|mailto:)/i.test(href)) continue
    links++
    const where = `${file}:${body.slice(0, match.index).split('\n').length}`
    try {
      if (/^(?:[a-z]:|\/|\\)/i.test(href)) throw Error('请使用仓库相对路径')
      const [destination, fragment] = href.split('#')
      const target = path.resolve(path.dirname(path.join(root, file)), decodeURIComponent(destination) || path.basename(file))
      const local = relative(target)
      if (local === '..' || local.startsWith('../') || path.isAbsolute(local)) throw Error('链接超出仓库')
      if (/^(?:docs|node_modules|out|release)(?:\/|$)|^android\/(?:build|app\/src\/main\/assets)(?:\/|$)/.test(local)) throw Error('入口不能依赖本机历史或生成产物')
      if (!fs.existsSync(target)) throw Error('目标不存在')
      if (!exactPath(target)) throw Error('路径大小写与实际文件不符')
      if (fragment && local.endsWith('.md')) {
        const targetText = content.get(local) ?? read(local)
        if (!anchors(targetText).has(decodeURIComponent(fragment))) throw Error('标题锚点不存在')
      }
    } catch (error) { errors.push(`${where} ${href}: ${error.message}`) }
  }
  // 当前文档只用直接 pnpm <script>、pnpm run <script> 或以下内置命令。
  for (const match of text.matchAll(/\bpnpm\s+(?:run\s+)?([a-z][a-z0-9:_-]*)/g)) {
    commands++
    if (!['install', 'exec'].includes(match[1]) && !Object.hasOwn(pkg.scripts, match[1])) errors.push(`${file}: 未定义的 pnpm 命令 ${match[1]}`)
  }
  if (/\b[A-Za-z]:[\\/]/.test(text)) errors.push(`${file}: 不应包含本机绝对路径`)
}

const state = content.get('handbook/CURRENT_STATE.md') || ''
const manifest = read('android/app/src/main/AndroidManifest.xml')
const migrations = read('src/shared/databaseSchema.ts').split('export function getUserVersion')[0]
const schemaVersion = [...migrations.matchAll(/^\s*\(db\)\s*=>\s*\{/gm)].length
function version(label, documented, actual) {
  if (!documented || !actual || documented !== String(actual)) errors.push(`CURRENT_STATE ${label}: 文档=${documented ?? '缺失'}，源码=${actual ?? '缺失'}`)
}
version('package.version', state.match(/package\.version：\*\*([^*]+)\*\*/)?.[1], pkg.version)
version('schema', state.match(/数据库 schema：\*\*v(\d+)\*\*/)?.[1], schemaVersion)
version('versionCode', state.match(/Android versionCode：\*\*(\d+)\*\*/)?.[1], manifest.match(/android:versionCode="(\d+)"/)?.[1])
version('minSdk', state.match(/minSdk (\d+)/)?.[1], manifest.match(/android:minSdkVersion="(\d+)"/)?.[1])
version('targetSdk', state.match(/targetSdk (\d+)/)?.[1], manifest.match(/android:targetSdkVersion="(\d+)"/)?.[1])

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`文档检查通过：${documents.length} 份文档，${links} 个本地链接，${commands} 处 pnpm 命令，5 个版本字段；无本地 docs/ 链接依赖。`)
}
