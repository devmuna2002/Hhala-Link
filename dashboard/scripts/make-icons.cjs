// Generates desktop + web icons from the Hlala logo.
// Usage: node scripts/make-icons.cjs
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const _pngToIco = require('png-to-ico');
const pngToIco = _pngToIco.default || _pngToIco;

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '..', 'images', 'hlala-icon.jpg');

async function main() {
  const pubDir = path.join(ROOT, 'public');
  const eleDir = path.join(ROOT, 'electron');
  fs.mkdirSync(pubDir, { recursive: true });

  // 512px app icon: logo contained on white with breathing room
  const iconPng = await sharp(SRC)
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(pubDir, 'icon.png'), iconPng);
  fs.writeFileSync(path.join(eleDir, 'icon.png'), iconPng);

  const ico = await pngToIco(iconPng);
  fs.writeFileSync(path.join(eleDir, 'icon.ico'), ico);

  console.log('icons written: public/icon.png, electron/icon.png, electron/icon.ico');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
