import { useEffect, useRef, useState } from 'react';
import { AnimationMixer, Box3, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer, SRGBColorSpace, ACESFilmicToneMapping, Clock } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssetCache } from '../../engine/assets/AssetCache';
import { disposeObject } from '../../engine/assets/AssetCache';
import { Spinner } from '../../components/ui';

/** Interactive 3D preview of a model asset (one short-lived WebGL context). */
export function ModelPreview({ cache, assetId, animation }: { cache: AssetCache; assetId: string; animation?: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let renderer: WebGLRenderer | null = null;
    let frame = 0;
    let controls: OrbitControls | null = null;
    let cleanupModel: (() => void) | null = null;
    try {
      renderer = new WebGLRenderer({ antialias: true });
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      el.appendChild(renderer.domElement);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.touchAction = 'none';
    } catch {
      setState('error');
      setError('3D preview is not available on this device.');
      return;
    }
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.01, 5000);
    scene.add(new HemisphereLight('#ffffff', '#666677', 1.4));
    const sun = new DirectionalLight('#ffffff', 2);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;
    const clock = new Clock();
    let mixer: AnimationMixer | null = null;

    const resize = () => {
      if (!renderer) return;
      const w = el.clientWidth || 300;
      const h = el.clientHeight || 225;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    cache
      .instantiateModel(assetId)
      .then((model) => {
        if (disposed) {
          disposeObject(model.scene, { keepShared: true });
          return;
        }
        scene.add(model.scene);
        cleanupModel = () => disposeObject(model.scene, { keepShared: true });
        const box = new Box3().setFromObject(model.scene);
        const center = box.getCenter(new Vector3());
        const size = box.getSize(new Vector3()).length() || 1;
        controls!.target.copy(center);
        camera.position.copy(center).add(new Vector3(size * 0.7, size * 0.45, size * 0.9));
        camera.near = size / 100;
        camera.far = size * 100;
        camera.updateProjectionMatrix();
        const clip = model.animations.find((a) => a.name === animation) ?? model.animations[0];
        if (clip) {
          mixer = new AnimationMixer(model.scene);
          mixer.clipAction(clip).play();
        }
        setState('ready');
      })
      .catch((err: unknown) => {
        setState('error');
        setError((err as Error).message);
      });

    const loop = () => {
      frame = requestAnimationFrame(loop);
      mixer?.update(clock.getDelta());
      controls?.update();
      renderer?.render(scene, camera);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls?.dispose();
      cleanupModel?.();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
  }, [cache, assetId, animation]);

  return (
    <div className="model-preview" style={{ position: 'relative' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {state === 'loading' && (
        <div className="viewport-message">
          <Spinner label="Loading model" />
        </div>
      )}
      {state === 'error' && (
        <div className="viewport-message">
          <div className="banner banner-danger small">{error}</div>
        </div>
      )}
    </div>
  );
}
