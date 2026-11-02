import type { ToastOptions } from '../../components/feedback';
import type { EditorSession } from '../../editor/EditorSession';
import { ACCEPTED_FILE_TYPES, AssetImportError, importAssetFile, type ImportStage } from '../../engine/assets/importers';
import type { AssetMeta } from '../../engine/project/types';
import { pickFiles } from '../../platform/platform';

export interface ImportProgress {
  fileName: string;
  stage: ImportStage;
  fraction: number;
  index: number;
  total: number;
}

/** Imports files into the project, reporting progress and every failure clearly. */
export async function importFiles(
  session: EditorSession,
  files: File[],
  toast: (t: ToastOptions) => void,
  onProgress?: (p: ImportProgress | null) => void,
): Promise<AssetMeta[]> {
  const imported: AssetMeta[] = [];
  for (const [index, file] of files.entries()) {
    try {
      const result = await importAssetFile(file, (stage, fraction) =>
        onProgress?.({ fileName: file.name, stage, fraction, index, total: files.length }),
      );
      onProgress?.({ fileName: file.name, stage: 'saving', fraction: 0.95, index, total: files.length });
      await session.addAsset(result.meta, result.data);
      imported.push(result.meta);
      session.log('info', `Imported ${file.name}`, 'Assets');
      for (const w of result.warnings) {
        session.log('warn', `${file.name}: ${w}`, 'Assets');
        toast({ tone: 'warning', title: `${file.name} imported with a warning`, description: w });
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      const hint = err instanceof AssetImportError ? err.hint : undefined;
      session.log('error', `${file.name}: ${message}${hint ? ` ${hint}` : ''}`, 'Assets');
      toast({ tone: 'error', title: `Could not import ${file.name}`, description: hint ? `${message} ${hint}` : message });
    }
  }
  onProgress?.(null);
  if (imported.length) {
    toast({
      tone: 'success',
      title: imported.length === 1 ? `${imported[0]!.name} imported` : `${imported.length} assets imported`,
      description: 'Find it in Assets.',
    });
  }
  return imported;
}

export async function importAssetsInteractive(
  session: EditorSession,
  toast: (t: ToastOptions) => void,
  accept = ACCEPTED_FILE_TYPES,
  onProgress?: (p: ImportProgress | null) => void,
): Promise<AssetMeta[]> {
  const files = await pickFiles(accept, true);
  if (files.length === 0) return [];
  return importFiles(session, files, toast, onProgress);
}
