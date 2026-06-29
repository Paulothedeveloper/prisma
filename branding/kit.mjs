// Gera peças de marca pro kit de Apresentação + enriquecer o GitHub. Dep-free (sharp).
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const AP = "G:/Meu Drive/VAULTS/1 - MANUAL DO CLAUDE/🎨 Design-UX/PRISMA/Apresentação";
const app = readFileSync("branding/prisma-icon-app.svg");
const D = 384;
const ren = (svg) => sharp(Buffer.from(svg), { density: 72 }).png().toBuffer(); // 1:1 (layout/texto)
const iconPng = (s) => sharp(app, { density: D }).resize(s, s).png().toBuffer();

const SPECTRUM = ["#FF453A", "#FF9F0A", "#FFD60A", "#30D158", "#40C8E0", "#0A84FF", "#BF5AF2"];
const NEUTRALS = [["#1a1a1c", "bg"], ["#2c2c2e", "elev"], ["#f5f5f7", "text"], ["#98989d", "text-2"], ["#0a84ff", "accent"]];

// ---- Logotipo horizontal (ícone + wordmark PRISMA), transparente ----
async function logotipo() {
  const icon = await iconPng(180);
  const word = await ren(
    `<svg width="520" height="180" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="104" font-family="Inter, Segoe UI, Arial" font-size="92" font-weight="800" letter-spacing="6" fill="#F5F5F7">PRISMA</text>
      <text x="4" y="146" font-family="Inter, Segoe UI, Arial" font-size="24" letter-spacing="2" fill="#98989D">Gerenciador de assets · DAM</text>
    </svg>`
  );
  const out = sharp({ create: { width: 740, height: 180, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const png = await out.composite([{ input: icon, left: 0, top: 0 }, { input: word, left: 210, top: 8 }]).png().toBuffer();
  writeFileSync(`${AP}/01 - Logotipo/PRISMA-Logotipo-Horizontal.png`, png);
}

// ---- GitHub banner 1280x360 (dark, ícone + wordmark + tagline + faixa de espectro) ----
async function banner() {
  const bg = `<svg width="1280" height="360" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1a1a1c"/><stop offset="1" stop-color="#0c0c0f"/>
      </linearGradient>
      <radialGradient id="gl" cx="0.78" cy="0.7" r="0.6">
        <stop offset="0" stop-color="#0A84FF" stop-opacity="0.18"/><stop offset="1" stop-color="#0A84FF" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1280" height="360" fill="url(#g)"/>
    <rect width="1280" height="360" fill="url(#gl)"/>
    ${SPECTRUM.map((c, i) => `<rect x="0" y="${352 + 0}" width="1280" height="8" fill="${c}" opacity="0"/>`).join("")}
    <g>${SPECTRUM.map((c, i) => `<rect x="${(1280 / 7) * i}" y="352" width="${1280 / 7}" height="8" fill="${c}"/>`).join("")}</g>
    <text x="300" y="170" font-family="Inter, Segoe UI, Arial" font-size="96" font-weight="800" letter-spacing="8" fill="#F5F5F7">PRISMA</text>
    <text x="304" y="220" font-family="Inter, Segoe UI, Arial" font-size="30" letter-spacing="1" fill="#98989D">Gerenciador de assets (DAM) pro editor de vídeo &amp; designer</text>
    <text x="304" y="262" font-family="Inter, Segoe UI, Arial" font-size="22" letter-spacing="1" fill="#6e6e73">Tauri · React/TS · SQLite · ffmpeg — offline, não-destrutivo</text>
  </svg>`;
  const icon = await iconPng(200);
  const png = await sharp(Buffer.from(bg)).composite([{ input: icon, left: 70, top: 80 }]).png().toBuffer();
  writeFileSync("docs/banner.png", png);
  writeFileSync(`${AP}/18 - Elementos/PRISMA-Banner-GitHub.png`, png);
}

// ---- Paleta de cores (swatches com hex) ----
async function paleta() {
  const sw = 150, h = 150, pad = 24, n = SPECTRUM.length;
  const W = pad * 2 + sw * 4, H = 560;
  const chip = (x, y, c, label) =>
    `<rect x="${x}" y="${y}" width="${sw - 12}" height="${h - 40}" rx="16" fill="${c}"/>
     <text x="${x + 4}" y="${y + h - 12}" font-family="Inter, Arial" font-size="18" fill="#f5f5f7">${c}</text>
     ${label ? `<text x="${x + (sw - 12) - 4}" y="${y + h - 12}" font-family="Inter, Arial" font-size="15" fill="#98989d" text-anchor="end">${label}</text>` : ""}`;
  let chips = "";
  SPECTRUM.forEach((c, i) => { chips += chip(pad + (i % 4) * sw, 90 + Math.floor(i / 4) * h, c, ""); });
  NEUTRALS.forEach(([c, l], i) => { chips += chip(pad + (i % 4) * sw, 90 + 2 * h, c, l); });
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#161618"/>
    <text x="${pad}" y="52" font-family="Inter, Arial" font-size="34" font-weight="700" fill="#f5f5f7">PRISMA — Paleta</text>
    <text x="${pad}" y="${90 + 2 * h - 16}" font-family="Inter, Arial" font-size="20" font-weight="600" fill="#98989d">Neutros + accent</text>
    ${chips}</svg>`;
  writeFileSync(`${AP}/03 - Paleta de Cores/PRISMA-Paleta.png`, await ren(svg));
}

// ---- Avatar (ícone) ----
async function avatar() {
  writeFileSync(`${AP}/08 - Avatar Redes Sociais/PRISMA-Avatar-512.png`, await iconPng(512));
  writeFileSync(`${AP}/08 - Avatar Redes Sociais/PRISMA-Avatar-1024.png`, await iconPng(1024));
}

await logotipo();
await banner();
await paleta();
await avatar();
console.log("kit gerado: logotipo horizontal, banner GitHub, paleta, avatar");
