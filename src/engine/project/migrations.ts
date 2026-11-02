/**
 * Project schema migrations.
 *
 * Each migration upgrades raw (unvalidated) project JSON from version N to
 * N + 1. Migrations run before validation, so they must be defensive about
 * the shape of their input. Add a new entry whenever PROJECT_SCHEMA_VERSION
 * is increased and document the change in docs/PROJECT_FORMAT.md.
 */

type Raw = Record<string, unknown>;
type Migration = (project: Raw, warnings: string[]) => Raw;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * v0 → v1: the pre-release preview format.
 *  - `manifest.version` was renamed to `manifest.schemaVersion`
 *  - scenes were stored as an array instead of an id-keyed record
 *  - baseplates stored a single square `size` instead of `width`/`depth`
 */
const v0ToV1: Migration = (project, warnings) => {
  const manifest = isObj(project.manifest) ? { ...project.manifest } : {};
  delete manifest.version;
  manifest.schemaVersion = 1;
  manifest.format = manifest.format ?? 'zinogame-project';

  let scenes: unknown = project.scenes;
  if (Array.isArray(scenes)) {
    const record: Raw = {};
    for (const s of scenes) if (isObj(s) && typeof s.id === 'string') record[s.id] = s;
    scenes = record;
  }
  if (isObj(scenes)) {
    for (const scene of Object.values(scenes)) {
      if (!isObj(scene) || !Array.isArray(scene.objects)) continue;
      for (const obj of scene.objects) {
        const bp = isObj(obj) && isObj(obj.components) ? obj.components.baseplate : undefined;
        if (isObj(bp) && typeof bp.size === 'number') {
          bp.width = bp.size;
          bp.depth = bp.size;
          delete bp.size;
        }
      }
    }
  }
  warnings.push('Upgraded project from preview format (v0) to v1');
  return { ...project, manifest, scenes };
};

export const MIGRATIONS: Record<number, Migration> = {
  0: v0ToV1,
};

export function detectSchemaVersion(project: Raw): number {
  const m = project.manifest;
  if (!isObj(m)) return -1;
  if (typeof m.schemaVersion === 'number') return m.schemaVersion;
  if (typeof m.version === 'number') return m.version;
  return -1;
}

export function migrateProject(project: Raw, warnings: string[]): Raw {
  let current = project;
  let version = detectSchemaVersion(current);
  // Unknown versions fall through to validation, which reports a clear error.
  while (version >= 0 && MIGRATIONS[version]) {
    const migrate = MIGRATIONS[version] as Migration;
    current = migrate(structuredClone(current), warnings);
    version += 1;
  }
  return current;
}
