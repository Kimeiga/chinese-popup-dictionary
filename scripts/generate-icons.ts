import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, "../public/icons");

const sizes = [16, 48, 128];

interface IconConfig {
  suffix: string;
  bg: string;
  textColor: string;
  borderColor: string;
}

const states: IconConfig[] = [
  {
    suffix: "",
    bg: "#1d1a19",
    textColor: "#4bbffb",
    borderColor: "#504c4b",
  },
  {
    suffix: "-off",
    bg: "#5a5857",
    textColor: "#8a8785",
    borderColor: "#7a7877",
  },
];

function buildHTML(size: number, config: IconConfig): string {
  const fontSize = Math.round(size * 0.62);
  const radius = Math.round(size * 0.15);

  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; }
  body { background: transparent; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="c" width="${size}" height="${size}"></canvas>
<script>
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  const s = ${size};
  const r = ${radius};

  // Rounded rect background
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(s - r, 0);
  ctx.quadraticCurveTo(s, 0, s, r);
  ctx.lineTo(s, s - r);
  ctx.quadraticCurveTo(s, s, s - r, s);
  ctx.lineTo(r, s);
  ctx.quadraticCurveTo(0, s, 0, s - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();

  ctx.fillStyle = '${config.bg}';
  ctx.fill();

  ctx.strokeStyle = '${config.borderColor}';
  ctx.lineWidth = ${size >= 48 ? 1.5 : 1};
  ctx.stroke();

  // Centered character
  ctx.fillStyle = '${config.textColor}';
  ctx.font = 'bold ${fontSize}px "Noto Sans SC", "PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\\u5B57', s / 2, s / 2);
</script>
</body>
</html>`;
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });

  for (const config of states) {
    for (const size of sizes) {
      const page = await browser.newPage();
      await page.setViewport({
        width: size,
        height: size,
        deviceScaleFactor: 1,
      });

      const html = buildHTML(size, config);
      await page.setContent(html, { waitUntil: "networkidle0" });

      const canvas = await page.$("#c");
      if (!canvas) {
        throw new Error("Canvas element not found");
      }

      const filename = `icon${size}${config.suffix}.png`;
      const outputPath = path.join(outputDir, filename);

      await canvas.screenshot({ path: outputPath, omitBackground: true });
      console.log(`Generated ${filename}`);

      await page.close();
    }
  }

  await browser.close();
  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
