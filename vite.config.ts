import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

/**
 * Vite build config for MV3 Chrome extension.
 *
 * Builds as ES modules, then a post-build plugin inlines any shared chunks
 * directly into the entry points. MV3 content scripts declared in the
 * manifest cannot load relative ES module imports.
 */

function copyStaticAssets(): import('vite').Plugin {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      const dist = resolve(__dirname, 'dist');
      mkdirSync(resolve(dist, 'icons'), { recursive: true });
      mkdirSync(resolve(dist, 'assets'), { recursive: true });
      mkdirSync(resolve(dist, 'options'), { recursive: true });

      cpSync(resolve(__dirname, 'public/manifest.json'), resolve(dist, 'manifest.json'));

      const iconsDir = resolve(__dirname, 'public/icons');
      if (existsSync(iconsDir)) {
        cpSync(iconsDir, resolve(dist, 'icons'), { recursive: true });
      }

      const dictFile = resolve(__dirname, 'data/cedict.json');
      if (existsSync(dictFile)) {
        cpSync(dictFile, resolve(dist, 'assets/cedict.json'));
      }

      cpSync(resolve(__dirname, 'src/options/options.html'), resolve(dist, 'options/options.html'));
    },
  };
}

/**
 * Post-build: inline chunk imports into entry files so content scripts
 * don't need to load external modules (which MV3 forbids for content_scripts).
 */
function inlineChunks(): import('vite').Plugin {
  return {
    name: 'inline-chunks',
    closeBundle() {
      const dist = resolve(__dirname, 'dist');
      const entryFiles = ['background.js', 'content.js', 'options/options.js'];

      for (const entryFile of entryFiles) {
        const filePath = resolve(dist, entryFile);
        if (!existsSync(filePath)) continue;

        let code = readFileSync(filePath, 'utf-8');

        // Find all chunk imports: import { x as y } from "./chunks/name.js";
        const importRegex = /import\s*\{([^}]+)\}\s*from\s*"\.\/chunks\/([^"]+)";?\n?/g;
        let match;

        while ((match = importRegex.exec(code)) !== null) {
          const bindings = match[1]; // e.g. "t as DEFAULT_SETTINGS"
          const chunkFile = match[2]; // e.g. "types-B2MFS8Z8.js"
          const chunkPath = resolve(dist, 'chunks', chunkFile);

          if (!existsSync(chunkPath)) continue;

          const chunkCode = readFileSync(chunkPath, 'utf-8');

          // Extract the exported values from the chunk
          // Chunks typically look like: var x = ...; export { x as t };
          // We need to inline the var declarations and rename exports to match imports

          // Parse the binding: "t as DEFAULT_SETTINGS" → alias 't' to 'DEFAULT_SETTINGS'
          const bindingPairs = bindings.split(',').map(b => {
            const parts = b.trim().split(/\s+as\s+/);
            return { exported: parts[0].trim(), local: (parts[1] || parts[0]).trim() };
          });

          // Extract variable declarations from chunk (everything before export)
          let inlineCode = chunkCode
            .replace(/\/\/#region.*\n/g, '')
            .replace(/\/\/#endregion.*\n/g, '')
            .replace(/export\s*\{[^}]*\};?\s*$/m, '')
            .trim();

          // Rename exported vars to their local names in the importing file
          for (const { exported, local } of bindingPairs) {
            if (exported !== local) {
              // The chunk exports as 'exported', but the file uses 'local'
              // Find the var name in the chunk that maps to the export
              const exportMatch = chunkCode.match(new RegExp(`(\\w+)\\s+as\\s+${exported}`));
              const chunkVarName = exportMatch ? exportMatch[1] : exported;
              inlineCode = inlineCode.replace(
                new RegExp(`\\bvar\\s+${chunkVarName}\\b`),
                `var ${local}`
              );
              // Also replace any references
              inlineCode = inlineCode.replace(
                new RegExp(`\\b${chunkVarName}\\b`, 'g'),
                local
              );
            }
          }

          // Replace the import statement with the inlined code
          code = code.replace(match[0], inlineCode + '\n');
        }

        // Handle relative chunk imports for options (different path depth)
        code = code.replace(
          /import\s*\{([^}]+)\}\s*from\s*"\.\.\/chunks\/([^"]+)";?\n?/g,
          (fullMatch, bindings, chunkFile) => {
            const chunkPath = resolve(dist, 'chunks', chunkFile);
            if (!existsSync(chunkPath)) return fullMatch;

            const chunkCode = readFileSync(chunkPath, 'utf-8');
            const bindingPairs = bindings.split(',').map((b: string) => {
              const parts = b.trim().split(/\s+as\s+/);
              return { exported: parts[0].trim(), local: (parts[1] || parts[0]).trim() };
            });

            let inlineCode = chunkCode
              .replace(/\/\/#region.*\n/g, '')
              .replace(/\/\/#endregion.*\n/g, '')
              .replace(/export\s*\{[^}]*\};?\s*$/m, '')
              .trim();

            for (const { exported, local } of bindingPairs) {
              if (exported !== local) {
                const exportMatch = chunkCode.match(new RegExp(`(\\w+)\\s+as\\s+${exported}`));
                const chunkVarName = exportMatch ? exportMatch[1] : exported;
                inlineCode = inlineCode.replace(
                  new RegExp(`\\bvar\\s+${chunkVarName}\\b`),
                  `var ${local}`
                );
                inlineCode = inlineCode.replace(
                  new RegExp(`\\b${chunkVarName}\\b`, 'g'),
                  local
                );
              }
            }

            return inlineCode + '\n';
          }
        );

        writeFileSync(filePath, code);
      }

      // Remove chunks directory
      const chunksDir = resolve(dist, 'chunks');
      if (existsSync(chunksDir)) {
        const { rmSync } = require('fs');
        rmSync(chunksDir, { recursive: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  return {
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: isDev,
      minify: !isDev,
      target: 'es2020',
      rollupOptions: {
        input: {
          background: resolve(__dirname, 'src/background/service-worker.ts'),
          content: resolve(__dirname, 'src/content/content.ts'),
          'options/options': resolve(__dirname, 'src/options/options.ts'),
        },
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    plugins: [copyStaticAssets(), inlineChunks()],
  };
});
