import {
  Blocks,
  Box,
  Clapperboard,
  Image as ImageIcon,
  Music,
  Package,
  Palette,
  Pencil,
  Play,
  Plus,
  Shapes,
  Trash,
  Upload,
  Wand,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/AppController';
import { useEditor, useSession } from '../../app/services';
import { Dialog, useConfirm, useToast } from '../../components/feedback';
import { Button, EmptyState, IconButton, SearchInput, Tabs } from '../../components/ui';
import { assetCacheFor } from '../../editor/assetCacheRegistry';
import { ACCEPTED_FILE_TYPES, formatBytes } from '../../engine/assets/importers';
import type { AssetKind, AssetMeta } from '../../engine/project/types';
import { GameAudio } from '../../engine/audio/GameAudio';
import { applyAssetToSelection, createMaterialFromSelection, createPrefabFromSelection, placeAssetInScene } from './assetActions';
import { importAssetsInteractive, importFiles, type ImportProgress } from './importFlow';
import { ModelPreview } from './ModelPreview';

type AssetTab = 'all' | AssetKind | 'animations';

const KIND_INFO: Record<AssetKind, { label: string; icon: LucideIcon }> = {
  model: { label: 'Models', icon: Box },
  texture: { label: 'Textures', icon: ImageIcon },
  material: { label: 'Materials', icon: Palette },
  audio: { label: 'Audio', icon: Music },
  prefab: { label: 'Prefabs', icon: Shapes },
};

function TextureThumb({ asset }: { asset: AssetMeta }) {
  const session = useSession();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    void session.loadAssetData(asset.id).then((data) => {
      if (!data || revoked) return;
      objectUrl = URL.createObjectURL(new Blob([data], { type: asset.mimeType }));
      setUrl(objectUrl);
    });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, asset.id, asset.mimeType]);
  return url ? <img src={url} alt="" loading="lazy" /> : <ImageIcon size={32} aria-hidden="true" />;
}

export default function AssetsPage() {
  const session = useSession();
  const app = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const assets = useEditor(session, (s) => s.project.assets);
  const selectionCount = useEditor(session, (s) => s.selection.length);
  const [tab, setTab] = useState<AssetTab>('all');
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<AssetMeta | null>(null);
  const [renaming, setRenaming] = useState<AssetMeta | null>(null);
  const [audio] = useState(() => new GameAudio(session.loadAssetDataByName));
  useEffect(() => () => audio.dispose(), [audio]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(assets)
      .filter((a) => (tab === 'all' || tab === 'animations' ? true : a.kind === tab))
      .filter((a) => tab !== 'animations' || (a.model?.animations.length ?? 0) > 0)
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.fileName.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [assets, tab, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of Object.values(assets)) c[a.kind] = (c[a.kind] ?? 0) + 1;
    return c;
  }, [assets]);

  const busy = progress !== null;
  const doImport = () => void importAssetsInteractive(session, toast, ACCEPTED_FILE_TYPES, setProgress);

  const remove = async (asset: AssetMeta) => {
    const users = session.objectsUsingAsset(asset.id);
    const ok = await confirm({
      title: `Delete “${asset.name}”?`,
      message: users.length
        ? `${users.length} object(s) use this asset. Models will be removed from the scene and textures cleared. You can undo the scene change, but the asset file itself is deleted.`
        : 'The asset will be removed from this project.',
      confirmLabel: 'Delete asset',
      danger: true,
    });
    if (!ok) return;
    assetCacheFor(session).invalidate(asset.id);
    await session.deleteAsset(asset.id);
    toast({ tone: 'success', title: `Deleted ${asset.name}` });
  };

  const addToScene = (asset: AssetMeta) => {
    placeAssetInScene(session, asset, [0, 0, 0]);
    toast({ tone: 'success', title: `${asset.name} added to the scene` });
    app.navigate('create');
  };

  const apply = (asset: AssetMeta) => {
    const n = applyAssetToSelection(session, asset);
    toast(n ? { tone: 'success', title: `Applied to ${n} object(s)` } : { tone: 'info', title: 'Select an object first', description: 'Select shapes in Create, then apply this here.' });
  };

  return (
    <div
      className="page"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) void importFiles(session, files, toast, setProgress);
      }}
    >
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1 className="page-title">Assets</h1>
            <p className="page-subtitle">Models, textures, materials, sounds and prefabs in “{session.project.manifest.name}”.</p>
          </div>
          <div className="row row-wrap">
            <Button icon={Wand} disabled={selectionCount === 0} onClick={async () => {
              const a = await createPrefabFromSelection(session, `Prefab ${Object.values(assets).filter((x) => x.kind === 'prefab').length + 1}`);
              if (a) toast({ tone: 'success', title: 'Prefab saved', description: 'Place copies of it from Assets or the Add menu.' });
            }}>
              Save selection as prefab
            </Button>
            <Button icon={Palette} disabled={selectionCount === 0} onClick={async () => {
              const a = await createMaterialFromSelection(session, `Material ${Object.values(assets).filter((x) => x.kind === 'material').length + 1}`);
              toast(a ? { tone: 'success', title: 'Material saved' } : { tone: 'info', title: 'The selected object has no material' });
            }}>
              Save material
            </Button>
            <Button variant="primary" icon={Upload} onClick={doImport} disabled={busy}>
              Import files
            </Button>
          </div>
        </div>

        <div className="dropzone" data-over={dragOver}>
          {busy ? (
            <div className="stack" role="status" aria-live="polite">
              <strong>
                Importing {progress.fileName} ({progress.index + 1} of {progress.total})…
              </strong>
              <div className="progress" aria-hidden="true">
                <div style={{ width: `${Math.round(Math.max(0.05, progress.fraction) * 100)}%` }} />
              </div>
              <span className="small muted">
                {progress.stage === 'reading' ? 'Reading file' : progress.stage === 'processing' ? 'Checking and preparing' : 'Saving to project'}
              </span>
            </div>
          ) : (
            <>
              <Upload size={28} aria-hidden="true" />
              <p style={{ marginTop: 8 }}>
                <Button variant="ghost" onClick={doImport}>
                  Choose files
                </Button>{' '}
                or drop them here
              </p>
              <p className="small faint">.glb / .gltf models · .png / .jpg / .webp textures · .mp3 / .m4a / .wav sounds</p>
            </>
          )}
        </div>

        <div className="row row-wrap" style={{ gap: 12 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <Tabs<AssetTab>
              label="Asset types"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'all', label: 'All', icon: Blocks },
                ...(Object.keys(KIND_INFO) as AssetKind[]).map((k) => ({
                  id: k as AssetTab,
                  label: KIND_INFO[k].label,
                  icon: KIND_INFO[k].icon,
                  badge: counts[k] ? <span className="badge">{counts[k]}</span> : null,
                })),
                { id: 'animations', label: 'Animations', icon: Clapperboard },
              ]}
            />
          </div>
          <div style={{ width: 260 }}>
            <SearchInput value={query} onChange={setQuery} placeholder="Search assets" label="Search assets" />
          </div>
        </div>

        {list.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={tab === 'all' || tab === 'animations' ? Package : KIND_INFO[tab].icon}
              title={query ? 'No matching assets' : tab === 'animations' ? 'No animations yet' : 'Nothing here yet'}
              action={!query && tab !== 'material' && tab !== 'prefab' ? <Button icon={Plus} onClick={doImport}>Import files</Button> : undefined}
            >
              {tab === 'animations'
                ? 'Animations come inside imported .glb models.'
                : tab === 'prefab'
                  ? 'Select objects in Create and use “Save selection as prefab” to reuse them.'
                  : tab === 'material'
                    ? 'Select an object and use “Save material” to reuse its look.'
                    : 'Import models, images and sounds to use them in your game.'}
            </EmptyState>
          </div>
        ) : (
          <div className="asset-grid">
            {list.map((a) => {
              const Icon = KIND_INFO[a.kind].icon;
              return (
                <article key={a.id} className="card asset-card" aria-label={a.name}>
                  <div className="asset-thumb">
                    {a.kind === 'texture' ? (
                      <TextureThumb asset={a} />
                    ) : a.kind === 'material' && a.material ? (
                      <div style={{ width: 72, height: 72, borderRadius: '50%', background: `radial-gradient(circle at 35% 30%, #fff8 0, ${a.material.color} 45%, #0006 100%)` }} />
                    ) : (
                      <Icon size={36} aria-hidden="true" />
                    )}
                  </div>
                  <div className="asset-info">
                    <strong title={a.name}>{a.name}</strong>
                    <span className="small muted">
                      {KIND_INFO[a.kind].label.replace(/s$/, '')}
                      {a.size ? ` · ${formatBytes(a.size)}` : ''}
                      {a.model ? ` · ${a.model.triangles.toLocaleString('en-US')} tris` : ''}
                      {a.texture?.width ? ` · ${a.texture.width}×${a.texture.height}` : ''}
                      {a.audio?.durationSeconds ? ` · ${a.audio.durationSeconds}s` : ''}
                    </span>
                    {tab === 'animations' && a.model && (
                      <span className="small">{a.model.animations.join(', ')}</span>
                    )}
                    <div className="row row-wrap">
                      {(a.kind === 'model' || a.kind === 'prefab') && (
                        <Button size="sm" variant="primary" icon={Plus} onClick={() => addToScene(a)}>
                          Add to scene
                        </Button>
                      )}
                      {(a.kind === 'texture' || a.kind === 'material') && (
                        <Button size="sm" variant="primary" onClick={() => apply(a)}>
                          Apply to selected
                        </Button>
                      )}
                      {a.kind === 'model' && (
                        <Button size="sm" onClick={() => setPreview(a)}>
                          Preview
                        </Button>
                      )}
                      {a.kind === 'audio' && (
                        <Button
                          size="sm"
                          icon={Play}
                          onClick={() => {
                            audio.unlock();
                            audio.play(a.name);
                          }}
                        >
                          Play
                        </Button>
                      )}
                      <span className="spacer" />
                      <IconButton icon={Pencil} label={`Rename ${a.name}`} size="sm" onClick={() => setRenaming(a)} />
                      <IconButton icon={Trash} label={`Delete ${a.name}`} size="sm" onClick={() => void remove(a)} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {Object.values(assets).some((a) => a.kind === 'audio') && (
          <p className="small muted">Play sounds from scripts with the “play sound” block, using the sound’s name.</p>
        )}
      </div>

      {preview && (
        <Dialog
          title={preview.name}
          onClose={() => setPreview(null)}
          wide
          actions={
            <>
              <Button onClick={() => setPreview(null)}>Close</Button>
              <Button variant="primary" icon={Plus} onClick={() => { setPreview(null); addToScene(preview); }}>
                Add to scene
              </Button>
            </>
          }
        >
          <ModelPreview cache={assetCacheFor(session)} assetId={preview.id} animation={preview.model?.animations[0] ?? null} />
          {preview.model && (
            <p className="small muted">
              {preview.model.meshes} meshes · {preview.model.materials} materials · {preview.model.textures} textures ·{' '}
              {preview.model.animations.length ? `animations: ${preview.model.animations.join(', ')}` : 'no animations'}
            </p>
          )}
        </Dialog>
      )}
      {renaming && (
        <RenameDialog
          asset={renaming}
          onClose={() => setRenaming(null)}
          onRename={(name) => {
            session.renameAsset(renaming.id, name);
            setRenaming(null);
          }}
        />
      )}
    </div>
  );
}

function RenameDialog({ asset, onClose, onRename }: { asset: AssetMeta; onClose: () => void; onRename: (name: string) => void }) {
  const [name, setName] = useState(asset.name);
  return (
    <Dialog
      title="Rename asset"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => onRename(name)}>
            Rename
          </Button>
        </>
      }
    >
      <input className="input" aria-label="Asset name" value={name} maxLength={96} onChange={(e) => setName(e.target.value)} data-autofocus
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && onRename(name)} />
      {asset.kind === 'audio' && <p className="small muted">Scripts play sounds by name, so update any “play sound” blocks that use the old name.</p>}
    </Dialog>
  );
}
