#!/usr/bin/env node
    /**
     * Build script for Google Play Store distribution.
     *
     * Packages the PWA as a Trusted Web Activity (TWA) using Bubblewrap
     * (https://github.com/GoogleChromeLabs/bubblewrap), producing a signed
     * Android App Bundle (.aab) ready for upload to the Google Play Console.
     *
     * Prerequisites:
     *   - Node.js 18+
     *   - Java JDK 17+ (for Android build tools)
     *   - Bubblewrap CLI: `npm install -g @bubblewrap/cli`
     *   - The PWA must be deployed to a publicly accessible HTTPS URL with a
     *     valid Web App Manifest and Digital Asset Links file.
     *
     * Usage:
     *   node scripts/build-play.js --init    # Initialize TWA project (first time)
     *   node scripts/build-play.js --build   # Build .aab from existing TWA project
     *   node scripts/build-play.js           # Init if needed, then build
     *
     * Configuration:
     *   Set PWA_URL env var or edit PWA_URL constant below to your deployed
     *   PWA's HTTPS URL (e.g. https://yourdomain.com/arcade-of-life/).
     */

    import {
      copyFileSync,
      existsSync,
      mkdirSync,
      readFileSync,
      statSync,
      writeFileSync,
    } from 'fs';
    import { dirname, join, relative } from 'path';
    import { fileURLToPath } from 'url';
    import { execSync, spawnSync } from 'child_process';

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const projectRoot = join(__dirname, '..');

    // ---------------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------------

    /**
     * The publicly-accessible HTTPS URL where the PWA is hosted.
     * This MUST match the URL used in the Digital Asset Links verification.
     * Override via PWA_URL environment variable.
     */
    const PWA_URL = process.env.PWA_URL || 'https://example.com/arcade-of-life/';

    /**
     * Android application id (package name) for Play Store.
     * Must be globally unique and follow reverse-DNS convention.
     * Override via ANDROID_APP_ID environment variable.
     */
    const ANDROID_APP_ID =
      process.env.ANDROID_APP_ID || 'com.example.arcadeoflife.twa';

    /**
     * Directory (relative to project root) where the TWA Android project
     * will be generated and built.
     */
    const TWA_DIR = 'android-twa';

    /**
     * Directory where final distribution artifacts (.aab, .apk) are copied.
     */
    const DIST_DIR = 'dist';

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    function log(msg) {
      console.log(`[build-play] ${msg}`);
    }

    function warn(msg) {
      console.warn(`[build-play] WARNING: ${msg}`);
    }

    function fail(msg) {
      console.error(`[build-play] ERROR: ${msg}`);
      process.exit(1);
    }

    function hasCommand(cmd) {
      const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
        stdio: 'ignore',
      });
      return result.status === 0;
    }

    function run(cmd, opts = {}) {
      log(`$ ${cmd}`);
      execSync(cmd, { stdio: 'inherit', cwd: projectRoot, ...opts });
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
        const pkg = JSON.parse(
          readFileSync(join(projectRoot, 'package.json'), 'utf8'),
        );
        return pkg.version || '0.0.0';
      } catch {
        return '0.0.0';
      }
    }

    // ---------------------------------------------------------------------------
    // Preflight checks
    // ---------------------------------------------------------------------------

    function preflight() {
      log('Running preflight checks...');

      // Verify manifest exists and has required fields for TWA.
      const manifestPath = join(projectRoot, 'manifest.json');
      if (!existsSync(manifestPath)) {
        fail('manifest.json not found at project root.');
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const required = ['name', 'short_name', 'icons', 'start_url', 'display'];
      for (const key of required) {
        if (!manifest[key]) {
          warn(`manifest.json is missing recommended field: ${key}`);
        }
      }

      // Bubblewrap requires at least one 512x512 icon for TWA splash/launcher.
      const has512 = (manifest.icons || []).some(
        (i) => (i.sizes || '').split(' ').includes('512x512'),
      );
      if (!has512) {
        warn('manifest.json should include a 512x512 icon for Play Store TWA.');
      }

      // Verify Bubblewrap CLI is installed.
      if (!hasCommand('bubblewrap')) {
        fail(
          'Bubblewrap CLI not found. Install with:\n' +
            '    npm install -g @bubblewrap/cli\n' +
            '  Then re-run this script.',
        );
      }

      // Verify Java is installed (needed for Android Gradle build).
      if (!hasCommand('java')) {
        warn(
          'Java not found on PATH. Bubblewrap requires JDK 17+ for Android builds.',
        );
      }

      // Verify configured PWA_URL looks reasonable.
      if (!PWA_URL.startsWith('https://')) {
        fail(
          `PWA_URL must be an HTTPS URL. Got: ${PWA_URL}\n` +
            '  Set the PWA_URL environment variable or edit scripts/build-play.js.',
        );
      }
      if (PWA_URL.includes('example.com')) {
        warn(
          'PWA_URL is still set to a placeholder (example.com).\n' +
            '  Set PWA_URL=https://your-deployed-url/ before publishing.',
        );
      }

      log('Preflight OK.');
      log(`  PWA URL:   ${PWA_URL}`);
      log(`  App ID:    ${ANDROID_APP_ID}`);
      log(`  Version:   ${getVersion()}`);
    }

    // ---------------------------------------------------------------------------
    // Init: generate the TWA Android project from the deployed manifest.
    // ---------------------------------------------------------------------------

    function initTwa() {
      const twaPath = join(projectRoot, TWA_DIR);
      if (existsSync(twaPath) && existsSync(join(twaPath, 'twa-manifest.json'))) {
        log(`TWA project already exists at ${TWA_DIR}/. Skipping init.`);
        log('  Delete the directory to regenerate from scratch.');
        return;
      }

      mkdirSync(twaPath, { recursive: true });
      const manifestUrl = new URL('manifest.json', PWA_URL).toString();

      log(`Initializing TWA project from ${manifestUrl} ...`);
      log('  Bubblewrap will prompt for signing key + Android SDK details.');
      log('  Accept defaults unless you have a reason to change them.\n');

      run(`bubblewrap init --manifest="${manifestUrl}"`, { cwd: twaPath });

      // Patch the generated twa-manifest.json with our configured app id.
      const twaManifestPath = join(twaPath, 'twa-manifest.json');
      if (existsSync(twaManifestPath)) {
        try {
          const twaManifest = JSON.parse(readFileSync(twaManifestPath, 'utf8'));
          twaManifest.packageId = ANDROID_APP_ID;
          twaManifest.appVersionName = getVersion();
          writeFileSync(
            twaManifestPath,
            JSON.stringify(twaManifest, null, 2),
            'utf8',
          );
          log(`Patched twa-manifest.json with packageId=${ANDROID_APP_ID}`);
        } catch (err) {
          warn(`Could not patch twa-manifest.json: ${err.message}`);
        }
      }

      log('\nTWA project initialized.');
      log('Next steps:');
      log('  1. Host the generated assetlinks.json at:');
      log(`     ${new URL('.well-known/assetlinks.json', PWA_URL).toString()}`);
      log('  2. Run: npm run build:play:build');
    }

    // ---------------------------------------------------------------------------
    // Build: produce signed .aab + .apk
    // ---------------------------------------------------------------------------

    function buildTwa() {
      const twaPath = join(projectRoot, TWA_DIR);
      if (!existsSync(join(twaPath, 'twa-manifest.json'))) {
        fail(
          `No TWA project found at ${TWA_DIR}/.\n` +
            '  Run: npm run build:play:init',
        );
      }

      // Bump version in twa-manifest.json to match current package version
      // so each Play Store upload gets a fresh versionCode.
      try {
        const twaManifestPath = join(twaPath, 'twa-manifest.json');
        const twaManifest = JSON.parse(readFileSync(twaManifestPath, 'utf8'));
        twaManifest.appVersionName = getVersion();
        twaManifest.appVersionCode = (twaManifest.appVersionCode || 0) + 1;
        writeFileSync(
          twaManifestPath,
          JSON.stringify(twaManifest, null, 2),
          'utf8',
        );
        log(
          `Bumped appVersionCode to ${twaManifest.appVersionCode} ` +
            `(versionName=${twaManifest.appVersionName})`,
        );
      } catch (err) {
        warn(`Could not bump version in twa-manifest.json: ${err.message}`);
      }

      log('Updating TWA project from latest manifest changes...');
      run('bubblewrap update', { cwd: twaPath });

      log('Building signed Android App Bundle (.aab) ...');
      run('bubblewrap build', { cwd: twaPath });

      // Copy artifacts to dist/.
      const distDir = join(projectRoot, DIST_DIR);
      if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

      const version = getVersion();
      const artifacts = [
        { src: 'app-release-bundle.aab', dest: `play-store-v${version}.aab` },
        { src: 'app-release-signed.apk', dest: `play-store-v${version}.apk` },
      ];

      let copied = 0;
      for (const { src, dest } of artifacts) {
        const srcPath = join(twaPath, src);
        const destPath = join(distDir, dest);
        if (existsSync(srcPath)) {
          copyFileSync(srcPath, destPath);
          const size = statSync(destPath).size;
          log(
            `✓ ${relative(projectRoot, destPath)} ` +
              `(${(size / 1024).toFixed(1)} KB)`,
          );
          copied++;
        }
      }

      if (copied === 0) {
        warn(
          'No build artifacts found in TWA directory. Check bubblewrap output above.',
        );
      } else {
        log('\nBuild complete.');
        log(`  Upload the .aab file to: https://play.google.com/console`);
      }
    }

    // ---------------------------------------------------------------------------
    // Main
    // ---------------------------------------------------------------------------

    function main() {
      const args = process.argv.slice(2);
      const initOnly = args.includes('--init');
      const buildOnly = args.includes('--build');

      preflight();

      if (initOnly) {
        initTwa();
        return;
      }
      if (buildOnly) {
        buildTwa();
        return;
      }
      // Default: init if needed, then build.
      initTwa();
      buildTwa();
    }

    main();