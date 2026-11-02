#!/usr/bin/env node
/**
 * Validates the Capacitor + iOS project configuration and the iOS GitHub
 * Actions workflow without needing macOS or Xcode. Run in CI before the
 * native build so configuration mistakes fail fast and cheaply.
 *
 * Usage: node scripts/validate-capacitor.mjs [--require-build]
 *   --require-build  also require the web build (dist/) to exist
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireBuild = process.argv.includes('--require-build');
const errors = [];
const passed = [];

const check = (ok, message) => (ok ? passed.push(message) : errors.push(message));
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const exists = (rel) => existsSync(join(root, rel));

// ── capacitor.config.ts ──────────────────────────────────────────────────
const capConfig = read('capacitor.config.ts');
const appId = /appId:\s*'([^']+)'/.exec(capConfig)?.[1];
const appName = /appName:\s*'([^']+)'/.exec(capConfig)?.[1];
const webDir = /webDir:\s*'([^']+)'/.exec(capConfig)?.[1];
check(appId === 'com.zinogame.studio', `capacitor.config.ts appId is com.zinogame.studio (found ${appId})`);
check(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/.test(appId ?? ''), 'appId is a valid reverse-DNS bundle identifier');
check(appName === 'ZinoGame Studio', `appName is "ZinoGame Studio" (found ${appName})`);
check(webDir === 'dist', `webDir is dist (found ${webDir})`);
if (requireBuild) {
  check(exists('dist/index.html'), 'web build exists (dist/index.html)');
  check(exists('dist/blockly-media'), 'Blockly media is bundled for offline use (dist/blockly-media)');
  if (exists('dist/index.html')) {
    const html = read('dist/index.html');
    check(!/(src|href)="https?:\/\//.test(html), 'built index.html loads nothing from the network');
  }
}

// ── package.json ─────────────────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'));
const capPlugins = Object.keys({ ...pkg.dependencies }).filter((d) => d.startsWith('@capacitor/') && !['@capacitor/core'].includes(d));
const capVersions = ['@capacitor/core', '@capacitor/cli', '@capacitor/ios'].map((p) => pkg.dependencies?.[p] ?? pkg.devDependencies?.[p]);
check(capVersions.every((v) => v && v === capVersions[0]), `Capacitor core/cli/ios versions match (${capVersions.join(', ')})`);
check(exists('package-lock.json'), 'package-lock.json is committed');

// ── iOS project ──────────────────────────────────────────────────────────
check(exists('ios/App/App.xcodeproj/project.pbxproj'), 'iOS Xcode project exists');
if (exists('ios/App/App.xcodeproj/project.pbxproj')) {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const ids = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
  check(ids.length > 0 && ids.every((id) => id === appId), `Xcode bundle identifier matches appId (${[...new Set(ids)].join(', ')})`);
  check(/TARGETED_DEVICE_FAMILY = "1,2";/.test(pbx), 'Xcode target supports iPhone and iPad');
  check(!/DEVELOPMENT_TEAM = [A-Z0-9]{10};/.test(pbx), 'no development team is hard-coded (signing comes from CI secrets)');
}
if (exists('ios/App/App/Info.plist')) {
  const plist = read('ios/App/App/Info.plist');
  check(plist.includes('<string>ZinoGame Studio</string>'), 'Info.plist display name is ZinoGame Studio');
  check(/UIFileSharingEnabled<\/key>\s*<true\/>/.test(plist), 'Info.plist enables Files app access for exported projects');
  check(/LSSupportsOpeningDocumentsInPlace<\/key>\s*<true\/>/.test(plist), 'Info.plist supports opening documents in place');
  check(plist.includes('UISupportedInterfaceOrientations~ipad'), 'Info.plist lists iPad orientations');
  for (const o of ['Portrait', 'LandscapeLeft', 'LandscapeRight']) {
    check(plist.includes(`UIInterfaceOrientation${o}</string>`), `iPad orientation ${o} is allowed (no forced orientation)`);
  }
}
const iconPath = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
if (exists(iconPath)) {
  const png = readFileSync(join(root, iconPath));
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const colorType = png[25];
  check(w === 1024 && h === 1024, `App icon is 1024×1024 (found ${w}×${h})`);
  check(colorType === 2, 'App icon has no alpha channel (required by the App Store)');
} else {
  errors.push('App icon is missing');
}
if (exists('ios/App/CapApp-SPM/Package.swift')) {
  const spm = read('ios/App/CapApp-SPM/Package.swift');
  for (const plugin of capPlugins) {
    check(spm.includes(`node_modules/${plugin}`), `Swift package includes ${plugin} (run "npx cap sync ios" if not)`);
  }
  const swiftPm = /capacitor-swift-pm\.git", exact: "([^"]+)"/.exec(spm)?.[1];
  check(swiftPm === capVersions[0], `capacitor-swift-pm version (${swiftPm}) matches @capacitor/core (${capVersions[0]})`);
}

// ── GitHub Actions workflow ──────────────────────────────────────────────
const wfPath = '.github/workflows/ios-build.yml';
check(exists(wfPath), 'iOS workflow exists');
if (exists(wfPath)) {
  let wf = null;
  try {
    wf = parseYaml(read(wfPath));
    passed.push('iOS workflow is valid YAML');
  } catch (err) {
    errors.push(`iOS workflow YAML is invalid: ${err.message}`);
  }
  if (wf) {
    check(wf.permissions?.contents === 'read' && Object.keys(wf.permissions).length === 1, 'workflow uses minimal permissions (contents: read)');
    check(!!wf.on?.workflow_dispatch, 'workflow can be started manually (workflow_dispatch)');
    const jobs = wf.jobs ?? {};
    check(!!jobs.checks && !!jobs.ios, 'workflow has checks and ios jobs');
    check(String(jobs.ios?.['runs-on'] ?? '').startsWith('macos'), 'ios job runs on a GitHub-hosted macOS runner');
    check(jobs.ios?.needs === 'checks', 'ios job waits for web checks');
    const steps = Object.values(jobs).flatMap((j) => j.steps ?? []);
    const uses = steps.map((s) => s.uses).filter(Boolean);
    check(uses.length > 0 && uses.every((u) => /@[0-9a-f]{40}$/.test(u)), 'all third-party actions are pinned to commit SHAs');
    const allRun = steps.map((s) => s.run ?? '').join('\n');
    check(allRun.includes('npm ci'), 'dependencies are installed from the lockfile (npm ci)');
    check(allRun.includes('npx cap sync ios'), 'workflow syncs the Capacitor iOS project');
    check(!/\$\{\{\s*secrets\./.test(allRun), 'no secret is interpolated directly into a script');
    const artifactNames = steps.filter((s) => String(s.uses ?? '').startsWith('actions/upload-artifact')).map((s) => s.with?.name);
    check(artifactNames.includes('zinogame-studio-ios-build'), 'iOS artifact is named zinogame-studio-ios-build');
    for (const script of new Set([...allRun.matchAll(/(scripts\/[\w./-]+\.(?:sh|mjs))/g)].map((m) => m[1]))) {
      check(exists(script), `workflow helper ${script} exists`);
      if (script.endsWith('.sh') && exists(script)) check((statSync(join(root, script)).mode & 0o111) !== 0, `${script} is executable`);
    }
  }
}

// ── Secrets must never be committed ──────────────────────────────────────
const forbidden = /\.(p12|mobileprovision|cer|keychain-db)$/i;
const walk = (dir) => {
  for (const name of readdirSync(join(root, dir))) {
    if (['node_modules', '.git', 'dist', 'build-output'].includes(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (forbidden.test(name)) errors.push(`signing file must not be in the repository: ${rel}`);
  }
};
walk('');
passed.push('no signing certificates or provisioning profiles in the repository');

for (const p of passed) console.log(`  ✓ ${p}`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log(`\n${passed.length} checks passed, ${errors.length} failed.`);
process.exit(errors.length ? 1 : 0);
