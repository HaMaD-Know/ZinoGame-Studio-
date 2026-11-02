import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url).pathname;

describe('Build configuration', () => {
  it('passes the Capacitor, iOS project and workflow validation', () => {
    const result = spawnSync(process.execPath, ['scripts/validate-capacitor.mjs'], { cwd: root, encoding: 'utf8' });
    expect(result.stdout).toContain('0 failed');
    expect(result.status).toBe(0);
  });

  it('has a syntactically valid xcodebuild helper script', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/ci/xcodebuild-logged.sh'], { cwd: root })).not.toThrow();
  });

  it('pins exact dependency versions and keeps signing files out of git', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as Record<string, Record<string, string>>;
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const gitignore = readFileSync(`${root}.gitignore`, 'utf8');
    for (const pattern of ['*.p12', '*.mobileprovision', '*.cer']) expect(gitignore).toContain(pattern);
  });
});
