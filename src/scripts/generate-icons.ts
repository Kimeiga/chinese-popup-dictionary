#!/usr/bin/env npx tsx
/**
 * Generate simple SVG-based PNG icons for the extension.
 * Creates 16x16, 48x48, and 128x128 icons.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ICONS_DIR = resolve(import.meta.dirname || '.', '../../public/icons');

function generateSvg(size: number): string {
  const fontSize = Math.round(size * 0.55);
  const padding = Math.round(size * 0.12);
  const radius = Math.round(size * 0.15);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${padding / 2}" y="${padding / 2}" width="${size - padding}" height="${size - padding}" rx="${radius}" fill="#E74C3C"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
    font-family="'Noto Sans SC', 'Microsoft YaHei', sans-serif"
    font-size="${fontSize}" font-weight="700" fill="white">中</text>
</svg>`;
}

mkdirSync(ICONS_DIR, { recursive: true });

for (const size of [16, 48, 128]) {
  const svg = generateSvg(size);
  // Write as SVG for now — will need canvas conversion for PNG in production
  // For development, Chrome accepts SVG icons fine
  writeFileSync(resolve(ICONS_DIR, `icon${size}.svg`), svg);
  console.log(`Generated icon${size}.svg`);
}

// Also generate a simple PNG using a data URL approach
// For initial dev, let's just use the SVGs
console.log(
  'Note: For Chrome Web Store submission, convert SVGs to PNGs using a tool like sharp or Inkscape.'
);
console.log('Icons generated in', ICONS_DIR);
