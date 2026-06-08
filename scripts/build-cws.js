#!/usr/bin/env node
  /**
   * Build script for Chrome Web Store distribution.
   * Creates a zip file containing the extension files ready for upload
   * to the Chrome Web Store Developer Dashboard.
   */
  
  import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, readdirSync } from 'fs';
  import { join, relative, dirname } from 'path';
  import { fileURLToPath } from 'url';
  import { execSync } from 'child_process';
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = join(__dirname, '..');
  
  // Files/directories to include in the Chrome Web Store package.
  // Adjust this list to match your extension's structure.
  const INCLUDE = [
    'manifest.json',
    'src',
    'icons',
    'images',
    'index.html',
    'popup.html',
    'background.js',
    'content.js',
    'styles.css',
  ];
  
  // Patterns to exclude from the package.
  const EXCLUDE_PATTERNS = [
    /(^|\/)\.git(\/|$)/,
    /(^|\/)node_modules(\/|$)/,
    /(^|\/)test(\/|$)/,
    /(^|\/)tests(\/|$)/,
    /\.test\.js$/,
    /\.spec\.js$/,
    /\.DS_Store$/,
    /(^|\/)\.eslintrc/,
    /(^|\/)\.prettierrc/,
    /\.map$/,
  ];
  
  function shouldExclude(path) {
    return EXCLUDE_PATTERNS.some((pattern) => pattern.test(path));
  }
  
  function collectFiles(basePath, relPath = '') {
    const fullPath = join(basePath, relPath);
    if (!existsSync(fullPath)) return [];
  
    const stat = statSync(fullPath);
    if (stat.isFile()) {
      return shouldExclude(relPath) ? [] : [relPath];
    }
  
    if (stat.isDirectory()) {
      const entries = readdirSync(fullPath);
      const files = [];
      for (const entry of entries) {
        const childRel = relPath ? `${relPath}/${entry}` : entry;
        if (shouldExclude(childRel)) continue;
        files.push(...collectFiles(basePath, childRel));
      }
      return files;
    }
    return [];
  }
  
  function getVersion() {
    try {
      const manifestPath = join(projectRoot, 'manifest.json');
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.version) return manifest.version;
      }
    } catch {
      /* ignore */
    }
    try {
      const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
  
  function main() {
    const distDir = join(projectRoot, 'dist');
    if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
  
    const version = getVersion();
    const zipName = `chrome-web-store-v${version}.zip`;
    const zipPath = join(distDir, zipName);
  
    // Collect all files to include.
    const allFiles = [];
    for (const entry of INCLUDE) {
      const files = collectFiles(projectRoot, entry);
      allFiles.push(...files);
    }
  
    if (allFiles.length === 0) {
      console.error('No files found to package. Check the INCLUDE list in scripts/build-cws.js');
      process.exit(1);
    }
  
    console.log(`Packaging ${allFiles.length} files into ${relative(projectRoot, zipPath)}...`);
  
    // Use the system `zip` command for simplicity (no extra dependencies).
    // Remove any existing zip first to avoid appending.
    try {
      execSync(`rm -f "${zipPath}"`, { stdio: 'inherit' });
      const fileList = allFiles.map((f) => `"${f}"`).join(' ');
      execSync(`zip -r "${zipPath}" ${fileList}`, {
        cwd: projectRoot,
        stdio: 'inherit',
      });
    } catch (err) {
      console.error('Failed to create zip archive:', err.message);
      console.error('Make sure the `zip` command is installed on your system.');
      process.exit(1);
    }
  
    const finalSize = statSync(zipPath).size;
    console.log(`\n✓ Built ${zipName} (${(finalSize / 1024).toFixed(1)} KB)`);
    console.log(`  Location: ${zipPath}`);
    console.log(`  Upload to: https://chrome.google.com/webstore/devconsole`);
  }
  
  main();