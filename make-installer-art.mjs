// Artes do instalador PRISMA (estilo Apple): barra lateral escura com a logo + wordmark,
// e header claro com a logo. NSIS exige BMP → gera PNG (sharp) e converte com ffmpeg.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const LOGO = "src-tauri/icons/source-prisma.png";
const FFMPEG = "src-tauri/binaries/ffmpeg.exe";
mkdirSync("src-tauri/installer", { recursive: true });

const toBmp = (png, bmp) => {
  execFileSync(FFMPEG, ["-y", "-i", png, "-pix_fmt", "bgr24", bmp], { stdio: "ignore" });
};

// ---- Sidebar 164x314 (Welcome/Finish) — escuro, logo no topo + wordmark ----
const SW = 164, SH = 314;
const sidebarBg = Buffer.from(`
<svg width="${SW}" height="${SH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#161b27"/>
      <stop offset="1" stop-color="#080a12"/>
    </linearGradient>
    <linearGradient id="ray" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0.40" stop-color="#0a84ff" stop-opacity="0"/>
      <stop offset="0.62" stop-color="#0a84ff" stop-opacity="0.16"/>
      <stop offset="0.80" stop-color="#bf5af2" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#bf5af2" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${SW}" height="${SH}" fill="url(#g)"/>
  <rect width="${SW}" height="${SH}" fill="url(#ray)"/>
  <text x="${SW / 2}" y="208" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="22" font-weight="700" letter-spacing="3" fill="#ffffff">PRISMA</text>
  <text x="${SW / 2}" y="232" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="10" letter-spacing="0.5" fill="#8a909c">Biblioteca de assets</text>
  <rect x="${SW / 2 - 16}" y="248" width="32" height="2" rx="1" fill="#0a84ff" opacity="0.7"/>
</svg>`);
const sideLogo = await sharp(LOGO).resize(104, 104).png().toBuffer();
await sharp(sidebarBg)
  .composite([{ input: sideLogo, top: 70, left: Math.round((SW - 104) / 2) }])
  .png()
  .toFile("src-tauri/installer/sidebar.png");
toBmp("src-tauri/installer/sidebar.png", "src-tauri/installer/sidebar.bmp");

// ---- Header 150x57 (páginas internas, fundo claro) — logo + wordmark à direita ----
const HW = 150, HH = 57;
const headerBg = Buffer.from(`
<svg width="${HW}" height="${HH}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${HW}" height="${HH}" fill="#ffffff"/>
  <text x="${HW - 12}" y="34" text-anchor="end" font-family="Segoe UI, Arial, sans-serif"
        font-size="16" font-weight="700" letter-spacing="1.5" fill="#1b2030">PRISMA</text>
</svg>`);
const headLogo = await sharp(LOGO).resize(40, 40).png().toBuffer();
await sharp(headerBg)
  .composite([{ input: headLogo, top: 9, left: HW - 40 - 96 }])
  .png()
  .toFile("src-tauri/installer/header.png");
toBmp("src-tauri/installer/header.png", "src-tauri/installer/header.bmp");

console.log("OK -> sidebar.bmp + header.bmp");
