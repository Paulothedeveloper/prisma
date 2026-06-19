// Ícone do PRISMA a partir da LOGO REAL do Paulo.
// Detecta o squircle no render, recorta quadrado e aplica máscara squircle
// (cantos TRANSPARENTES). Saída 1024 → depois `tauri icon`.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SRC = "C:/Users/paulo/Downloads/SOFTWARE/LOGO SEM FUNDO TRANSPARENTE.jpg";
const OUT = "src-tauri/icons/source-prisma.png";

const meta = await sharp(SRC).metadata();
const W = meta.width, H = meta.height;

// 1) bbox do squircle: downscale + compara com a cor do canto (fundo navy).
const dw = 140, dh = Math.round((H / W) * 140);
const { data, info } = await sharp(SRC).resize(dw, dh).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
// luminância do pixel; o vidro/rim/triângulo/arco-íris são bem mais claros que o navy do fundo.
const lum = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
const TH = 78; // acima disso = squircle (fundo navy fica ~30-45)
let minX = dw, minY = dh, maxX = 0, maxY = 0;
for (let y = 0; y < dh; y++)
  for (let x = 0; x < dw; x++)
    if (lum((y * dw + x) * ch) > TH) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

const sx = W / dw, sy = H / dh;
const bx = minX * sx, by = minY * sy, bw = (maxX - minX + 1) * sx, bh = (maxY - minY + 1) * sy;
// quadrado centrado na bbox; uma folguinha de 1% pra não cortar a borda do vidro
const pad = 0.01 * Math.max(bw, bh);
const side = Math.min(Math.max(bw, bh) + pad * 2, W, H);
const cx = bx + bw / 2, cy = by + bh / 2;
const left = Math.round(Math.max(0, Math.min(W - side, cx - side / 2)));
const top = Math.round(Math.max(0, Math.min(H - side, cy - side / 2)));
const s = Math.round(side);
console.log(`Imagem ${W}x${H} | bbox ${Math.round(bw)}x${Math.round(bh)} @${Math.round(bx)},${Math.round(by)} | crop ${s}x${s} @${left},${top}`);

// 2) recorta e leva pra 1024
const SIZE = 1024;
const cropped = await sharp(SRC)
  .extract({ left, top, width: s, height: s })
  .resize(SIZE, SIZE, { fit: "cover" })
  .png()
  .toBuffer();

// 3) máscara squircle (raio ~23%) → cantos transparentes
const r = Math.round(SIZE * 0.23);
const mask = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg"><rect width="${SIZE}" height="${SIZE}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
);

mkdirSync("src-tauri/icons", { recursive: true });
const masked = await sharp(cropped).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
await sharp(masked).toFile(OUT);

// cópia pro frontend (mark interno do app) em 256px transparente
mkdirSync("src/assets", { recursive: true });
await sharp(masked).resize(256, 256).png().toFile("src/assets/logo.png");
console.log("OK ->", OUT, "+ src/assets/logo.png");
