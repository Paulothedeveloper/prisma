// Cascata da nova marca PRISMA — gera .ico (variante PC), instalador, logo da UI, README, favicon.
// Dep-free (só sharp, já no projeto). Embute PNG dentro do ICO (Windows Vista+).
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const APP = readFileSync("branding/prisma-icon-app.svg");
const PC = readFileSync("branding/prisma-icon-pc.svg");
const D = 384;
const png = (svg, w, h) => sharp(svg, { density: D }).resize(w, h ?? w).png().toBuffer();

// ---- 1) icon.ico a partir da variante PC (nítida em 16-48) + 256 do APP (rico) ----
async function buildIco() {
  const pcSizes = [16, 24, 32, 48, 64, 128];
  const imgs = [];
  for (const s of pcSizes) imgs.push({ s, buf: await png(PC, s) });
  imgs.push({ s: 256, buf: await png(APP, 256) }); // 256 = rico
  // monta container ICO com PNGs embutidos
  const count = imgs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  imgs.forEach((im, i) => {
    const b = i * 16;
    dir.writeUInt8(im.s >= 256 ? 0 : im.s, b + 0);
    dir.writeUInt8(im.s >= 256 ? 0 : im.s, b + 1);
    dir.writeUInt8(0, b + 2); dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4); dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(im.buf.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += im.buf.length;
  });
  const ico = Buffer.concat([header, dir, ...imgs.map((im) => im.buf)]);
  writeFileSync("src-tauri/icons/icon.ico", ico);
  // 32x32/64x64 standalone (tray/Linux) também da variante PC
  writeFileSync("src-tauri/icons/32x32.png", await png(PC, 32));
  writeFileSync("src-tauri/icons/64x64.png", await png(PC, 64));
  console.log("ico (PC) + 32/64 ok:", ico.length, "bytes,", count, "tamanhos");
}

// ---- 2) logo da UI (transparente, squircle) + README ----
async function buildLogos() {
  const b256 = await png(APP, 256);
  writeFileSync("src/assets/logo.png", b256);
  writeFileSync("docs/prisma-logo.png", b256);
  console.log("logo UI + README ok");
}

// ---- 3) instalador NSIS: sidebar 164x314 + header 150x57 ----
async function buildInstaller() {
  // fundo navy igual ao app
  const navy = { create: { width: 164, height: 314, channels: 4, background: { r: 18, g: 20, b: 30, alpha: 1 } } };
  // gradiente sutil via overlay
  const grad = Buffer.from(
    `<svg width="164" height="314"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#202435"/><stop offset="1" stop-color="#0C0D14"/></linearGradient></defs>
      <rect width="164" height="314" fill="url(#g)"/></svg>`
  );
  const icon = await png(APP, 104);
  const word = Buffer.from(
    `<svg width="164" height="70"><text x="82" y="30" font-family="Segoe UI, Arial" font-size="26" font-weight="700" letter-spacing="3" fill="#F5F5F7" text-anchor="middle">PRISMA</text>
     <text x="82" y="54" font-family="Segoe UI, Arial" font-size="12" fill="#98989D" text-anchor="middle">Biblioteca de assets</text></svg>`
  );
  const sidebar = await sharp(grad).composite([
    { input: icon, left: 30, top: 64 },
    { input: await sharp(word).png().toBuffer(), left: 0, top: 196 },
  ]).png().toBuffer();
  writeFileSync("src-tauri/installer/sidebar.png", sidebar);
  // BMP (NSIS exige BMP) — sharp não escreve BMP; usa PNG salvo como .bmp não serve.
  // Solução: gerar BMP 24-bit manualmente a partir do raw.
  await writeBmp("src-tauri/installer/sidebar.bmp", sidebar, 164, 314);

  // header 150x57: ícone + wordmark, fundo branco (padrão NSIS header)
  const hgrad = Buffer.from(`<svg width="150" height="57"><rect width="150" height="57" fill="#FFFFFF"/></svg>`);
  const hicon = await png(APP, 44);
  const hword = Buffer.from(
    `<svg width="100" height="57"><text x="0" y="35" font-family="Segoe UI, Arial" font-size="22" font-weight="700" letter-spacing="2" fill="#1a1a1c">PRISMA</text></svg>`
  );
  const header = await sharp(hgrad).composite([
    { input: hicon, left: 6, top: 6 },
    { input: await sharp(hword).png().toBuffer(), left: 56, top: 0 },
  ]).png().toBuffer();
  writeFileSync("src-tauri/installer/header.png", header);
  await writeBmp("src-tauri/installer/header.bmp", header, 150, 57);
  console.log("instalador sidebar+header (png+bmp) ok");
}

// BMP 24-bit bottom-up a partir de um PNG (achata alpha sobre o fundo do próprio pixel)
async function writeBmp(path, pngBuf, w, h) {
  const { data } = await sharp(pngBuf).resize(w, h).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixSize = rowSize * h;
  const fileSize = 54 + pixSize;
  const buf = Buffer.alloc(fileSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixSize, 34);
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y; // bottom-up
    let p = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const s = (srcY * w + x) * 3;
      buf[p++] = data[s + 2]; // B
      buf[p++] = data[s + 1]; // G
      buf[p++] = data[s + 0]; // R
    }
  }
  writeFileSync(path, buf);
}

// ---- 4) favicon (svg vetor) ----
function buildFavicon() {
  // copia o app svg como favicon vetor
  writeFileSync("public/prisma.svg", readFileSync("branding/prisma-icon-app.svg"));
  console.log("favicon public/prisma.svg ok");
}

await buildIco();
await buildLogos();
await buildInstaller();
buildFavicon();
console.log("CASCATA COMPLETA");
