// Génère les icônes PWA (PNG) à partir d'un SVG, via sharp.
// Usage : node scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons"
);

// Icône : carré arrondi dégradé teal + glyphe agenda (barre du haut + points).
function svg({ padded = false } = {}) {
  // Pour l'icône "maskable", on garde une marge de sécurité (safe zone).
  const s = 512;
  const inset = padded ? 96 : 40;
  const r = padded ? 0 : 112; // maskable = fond plein, sinon coins arrondis
  const bg = padded
    ? `<rect width="${s}" height="${s}" fill="url(#g)"/>`
    : `<rect x="8" y="8" width="${s - 16}" height="${s - 16}" rx="${r}" fill="url(#g)"/>`;
  const cardX = inset;
  const cardY = inset + 20;
  const cardW = s - inset * 2;
  const cardH = s - inset * 2 - 20;
  const dot = (cx, cy) =>
    `<circle cx="${cx}" cy="${cy}" r="18" fill="#0b1220" opacity="0.55"/>`;
  const col = [cardX + cardW * 0.28, cardX + cardW * 0.5, cardX + cardW * 0.72];
  const row = [cardY + cardH * 0.5, cardY + cardH * 0.74];
  const dots = row.flatMap((cy) => col.map((cx) => dot(cx, cy))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14b8a6"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  ${bg}
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="40" fill="#ffffff" opacity="0.96"/>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="70" rx="40" fill="#0f766e"/>
  <rect x="${cardX}" y="${cardY + 40}" width="${cardW}" height="30" fill="#0f766e"/>
  ${dots}
</svg>`;
}

const targets = [
  { name: "icon-192.png", size: 192, padded: false },
  { name: "icon-512.png", size: 512, padded: false },
  { name: "maskable-512.png", size: 512, padded: true },
  { name: "apple-touch-icon.png", size: 180, padded: true }, // iOS aime le fond plein
];

await mkdir(outDir, { recursive: true });
for (const t of targets) {
  const buf = Buffer.from(svg({ padded: t.padded }));
  await sharp(buf).resize(t.size, t.size).png().toFile(path.join(outDir, t.name));
  console.log("écrit", t.name);
}
// On garde aussi le SVG source (utile pour favicon).
await writeFile(path.join(outDir, "icon.svg"), svg({ padded: false }));
console.log("terminé");
