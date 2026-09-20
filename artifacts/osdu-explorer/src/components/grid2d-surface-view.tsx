// 3D surface view for a RESQML Grid2dRepresentation.
//
// This is the ONLY module that imports three / @react-three/fiber. It is loaded
// lazily (React.lazy) from the JSON viewer toolbar, so the rest of the app
// compiles and runs even before these deps are installed. Default export is
// required for React.lazy.

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Button } from "@/components/ui/button";
import { buildGrid2dMesh, type Grid2dSurface } from "@/lib/grid2d-mesh";
import {
  robustDomain,
  mapScalarsToColors,
  COLORMAP_NAMES,
  type ColormapName,
} from "@/lib/colormap";
import { Grid2dColormapLegend } from "@/components/grid2d-colormap-legend";

function webglAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/** Creates OrbitControls, frames the camera to `bounds`, re-fits on resetKey. */
function SceneControls({
  bounds,
  resetKey,
}: {
  bounds: { min: [number, number, number]; max: [number, number, number] };
  resetKey: number;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useMemo(
    () => new OrbitControls(camera, gl.domElement),
    [camera, gl],
  );

  useEffect(() => {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    return () => controls.dispose();
  }, [controls]);

  useEffect(() => {
    const { min, max } = bounds;
    const center = new THREE.Vector3(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    );
    const size = new THREE.Vector3(
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
    );
    const radius = Math.max(size.length() * 0.5, 1e-3);
    const dir = new THREE.Vector3(1, -1, 0.8).normalize();
    camera.position.copy(center).addScaledVector(dir, radius * 2.4);
    camera.up.set(0, 0, 1);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = radius / 100;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
    }
    controls.target.copy(center);
    controls.update();
  }, [bounds, resetKey, camera, controls]);

  useFrame(() => controls.update());
  return null;
}

function SurfaceMesh({
  positions,
  indices,
  colors,
  wireframe,
}: {
  positions: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
  wireframe: boolean;
}) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [positions, indices, colors]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        side={THREE.DoubleSide}
        wireframe={wireframe}
        roughness={0.85}
        metalness={0.05}
        flatShading={false}
      />
    </mesh>
  );
}

export default function Grid2dSurfaceView({ surface }: { surface: Grid2dSurface }) {
  const [colormap, setColormap] = useState<ColormapName>("viridis");
  const [wireframe, setWireframe] = useState(false);
  const [zScale, setZScale] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const hasWebgl = useMemo(webglAvailable, []);

  const domain = useMemo(() => robustDomain(surface.z), [surface]);
  const mesh = useMemo(() => buildGrid2dMesh(surface, zScale), [surface, zScale]);
  const colors = useMemo(
    () => mapScalarsToColors(surface.z, domain, colormap),
    [surface, domain, colormap],
  );

  if (!hasWebgl) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        3D rendering is unavailable — this browser/session has no WebGL context.
        Use the Table view to inspect the array values instead.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-border/40 bg-[#0b0f14]">
      {/* Controls */}
      <div className="absolute left-2 top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background/85 px-2 py-1.5 backdrop-blur-sm">
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Colormap
          <select
            value={colormap}
            onChange={(e) => setColormap(e.target.value as ColormapName)}
            className="h-6 rounded border border-border/50 bg-background px-1 text-[11px] text-foreground"
          >
            {COLORMAP_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Z×{zScale.toFixed(1)}
          <input
            type="range"
            min={0.2}
            max={10}
            step={0.1}
            value={zScale}
            onChange={(e) => setZScale(Number(e.target.value))}
            className="h-1 w-24 cursor-pointer"
            aria-label="Vertical exaggeration"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setWireframe((w) => !w)}
        >
          {wireframe ? "Solid" : "Wireframe"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setResetKey((k) => k + 1)}
        >
          Reset view
        </Button>
      </div>

      {/* Legend */}
      <div className="absolute right-2 top-2 z-10">
        <Grid2dColormapLegend
          name={colormap}
          domain={domain}
          label={surface.title || "Elevation"}
          units={surface.units}
        />
      </div>

      {/* Summary */}
      <div className="absolute bottom-2 left-2 z-10 rounded bg-background/70 px-2 py-1 text-[10px] font-mono text-muted-foreground backdrop-blur-sm">
        {surface.ni}×{surface.nj} · z [{mesh.zMin.toLocaleString()}, {mesh.zMax.toLocaleString()}]
        {surface.units ? ` ${surface.units}` : ""} · nulls {mesh.nullCount} · XY {mesh.xySource}
      </div>

      <Canvas
        camera={{ fov: 45, position: [1, -1, 1], up: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#0b0f14"]} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[1, -1, 2]} intensity={1.1} />
        <directionalLight position={[-1, 1, 0.5]} intensity={0.35} />
        <SurfaceMesh
          positions={mesh.positions}
          indices={mesh.indices}
          colors={colors}
          wireframe={wireframe}
        />
        <SceneControls bounds={mesh.bounds} resetKey={resetKey} />
      </Canvas>
    </div>
  );
}
