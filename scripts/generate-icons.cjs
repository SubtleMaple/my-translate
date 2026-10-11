// Chromium SVG rasterization + PNG-backed multi-resolution ICO; no native dependency.
// Run: pnpm exec electron scripts/generate-icons.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const build = path.resolve(__dirname, '../build')
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, i) => {
    const p = 6 + i * 16
    header[p] = header[p + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, p + 4); header.writeUInt16LE(32, p + 6)
    header.writeUInt32LE(png.length, p + 8); header.writeUInt32LE(offset, p + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map(i => i.png)])
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await win.loadURL('data:text/html,<html></html>')
  const render = async (svg, width, height = width) => {
    const data = await win.webContents.executeJavaScript(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};
      await image.decode(); const canvas = document.createElement('canvas'); canvas.width = ${width}; canvas.height = ${height};
      canvas.getContext('2d').drawImage(image, 0, 0, ${width}, ${height}); return canvas.toDataURL('image/png').split(',')[1];
    })()`)
    return Buffer.from(data, 'base64')
  }
  const svg = fs.readFileSync(path.join(build, 'logo.svg'), 'utf8')
  const sizes = [16, 20, 24, 32, 48, 64, 128, 256]
  const images = []
  for (const size of sizes) images.push({ size, png: await render(svg, size) })
  fs.writeFileSync(path.join(build, 'icon.ico'), ico(images))
  // Tiny tray sizes omit the interior strokes so the silhouette stays legible.
  const traySvg = svg.replace(/<path d="M17[^>]+\/>/, '')
  const tray = []
  for (const size of [16, 20, 24, 32, 48]) tray.push({ size, png: await render(traySvg, size) })
  fs.writeFileSync(path.join(build, 'tray.ico'), ico(tray))
  fs.writeFileSync(path.join(build, 'logo.png'), await render(svg, 512))
  fs.writeFileSync(path.join(build, 'logo-studies.png'), await render(fs.readFileSync(path.join(build, 'logo-studies.svg'), 'utf8'), 960, 360))
  console.log('Generated icon.ico (8 sizes), tray.ico (5 sizes), logo.png, logo-studies.png')
  win.destroy(); app.quit()
}).catch(e => { console.error(e); app.exit(1) })
