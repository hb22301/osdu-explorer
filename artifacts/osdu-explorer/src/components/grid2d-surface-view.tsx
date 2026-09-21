import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Button } from "@/components/ui/button";
import {
  buildGrid2dMesh,
  buildGrid2dGridLines,
  buildGrid2dAxisAnnotations,
  buildGrid2dLocalAnnotations,
  type Grid2dSurface,
  type Grid2dGridLines,
  type Grid2dAxisAnnotations,
  type Grid2dLocalAnnotations,
} from "@/lib/grid2d-mesh";
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

type ViewPreset = "default" | "top";

function SceneControls({
  bounds,
  resetKey,
  view,
  autoRotate,
}: {
  bounds: { min: [number, number, number]; max: [number, number, number] };
  resetKey: number;
  view: ViewPreset;
  autoRotate: boolean;
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
    controls.autoRotateSpeed = 1.2;
    return () => controls.dispose();
  }, [controls]);

  useEffect(() => {
    controls.autoRotate = autoRotate;
  }, [controls, autoRotate]);

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
    if (view === "top") {
      const distance = Math.max(size.x, size.y) * 0.5 || radius;
      camera.position.set(center.x, center.y, center.z + distance * 2.4);
      camera.up.set(0, 1, 0);
    } else {
      const direction = new THREE.Vector3(1, -1, 0.8).normalize();
      camera.position.copy(center).addScaledVector(direction, radius * 2.4);
      camera.up.set(0, 0, 1);
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = radius / 100;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
    }
    controls.target.copy(center);
    controls.update();
  }, [bounds, resetKey, view, camera, controls]);

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
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    result.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    result.setIndex(new THREE.BufferAttribute(indices, 1));
    result.computeVertexNormals();
    result.computeBoundingSphere();
    return result;
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
        // Push the surface slightly back in depth so the grid overlay drawn on
        // the same nodes doesn't z-fight with it.
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  );
}

/**
 * Row/column (I/J) grid lines drawn on the surface, with a highlighted origin:
 * a marker sphere at node (0,0) and coloured I (red) and J (green) edge lines.
 */
function GridOverlay({
  lines,
  markerRadius,
}: {
  lines: Grid2dGridLines;
  markerRadius: number;
}) {
  const geometries = useMemo(() => {
    const make = (arr: Float32Array) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      return g;
    };
    return {
      grid: make(lines.positions),
      iAxis: make(Float32Array.from([...lines.origin, ...lines.iAxisEnd])),
      jAxis: make(Float32Array.from([...lines.origin, ...lines.jAxisEnd])),
    };
  }, [lines]);

  useEffect(
    () => () => {
      geometries.grid.dispose();
      geometries.iAxis.dispose();
      geometries.jAxis.dispose();
    },
    [geometries],
  );

  return (
    <group>
      <lineSegments geometry={geometries.grid}>
        <lineBasicMaterial color="#9fb2c9" transparent opacity={0.55} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={geometries.iAxis}>
        <lineBasicMaterial color="#ff5b5b" depthTest={false} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={geometries.jAxis}>
        <lineBasicMaterial color="#4ade80" depthTest={false} depthWrite={false} />
      </lineSegments>
      <mesh position={lines.origin}>
        <sphereGeometry args={[markerRadius, 20, 20]} />
        <meshBasicMaterial color="#ffcc00" depthTest={false} />
      </mesh>
    </group>
  );
}

type LabelOrientation = "horizontal" | "vertical";

function drawLabelPill(context: CanvasRenderingContext2D, width: number, height: number) {
  const radius = 7;
  context.fillStyle = "rgba(11, 15, 20, 0.72)";
  context.beginPath();
  context.moveTo(radius, 0);
  context.arcTo(width, 0, width, height, radius);
  context.arcTo(width, height, 0, height, radius);
  context.arcTo(0, height, 0, 0, radius);
  context.arcTo(0, 0, width, 0, radius);
  context.closePath();
  context.fill();
}

/**
 * Render a short label onto a canvas and wrap it as a sprite texture. Vertical
 * labels bake a bottom-to-top rotation into the canvas so the sprite stays
 * upright (no distortion) while the text reads upward.
 */
function makeLabelTexture(text: string, orientation: LabelOrientation): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const fontSize = 22;
  const font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  context.font = font;
  const along = Math.ceil(context.measureText(text).width) + 12; // length of the text run
  const across = fontSize + 8; // thickness of the text run
  if (orientation === "vertical") {
    canvas.width = across;
    canvas.height = along;
  } else {
    canvas.width = along;
    canvas.height = across;
  }
  // Resizing the canvas resets its context, so re-apply the font/alignment.
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  drawLabelPill(context, canvas.width, canvas.height);
  context.fillStyle = "#e6edf5";
  if (orientation === "vertical") {
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(-Math.PI / 2); // reads bottom-to-top
    context.fillText(text, 0, 1);
  } else {
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A single camera-facing label pinned at `position` by one of its edges (via the
 * sprite `center`) so the text extends onto the outer side of the axis and never
 * overlaps the surface footprint.
 */
function TickLabel({
  text,
  position,
  orientation,
  scale,
  center,
}: {
  text: string;
  position: [number, number, number];
  orientation: LabelOrientation;
  scale: number;
  center: [number, number];
}) {
  const texture = useMemo(() => makeLabelTexture(text, orientation), [text, orientation]);
  useEffect(() => () => texture.dispose(), [texture]);
  const spriteRef = useRef<THREE.Sprite>(null);
  useEffect(() => {
    spriteRef.current?.center.set(center[0], center[1]);
  }, [center]);

  const aspect = texture.image.width / texture.image.height;
  const spriteScale: [number, number, number] =
    orientation === "vertical" ? [scale, scale / aspect, 1] : [scale * aspect, scale, 1];
  return (
    <sprite ref={spriteRef} position={position} scale={spriteScale}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}

/**
 * X/Y/Z world-coordinate axes drawn along three edges of the bounding box, each
 * with numeric tick labels: X (red), Y (green), Z elevation (blue). Y labels are
 * pinned left of the surface (−X), X labels below it (−Y) and written
 * bottom-to-top, so no label overlaps the footprint.
 */
function AxisAnnotations({
  annotations,
  labelScale,
  labelGap,
}: {
  annotations: Grid2dAxisAnnotations;
  labelScale: number;
  labelGap: number;
}) {
  const geometries = useMemo(() => {
    const line = (a: [number, number, number], b: [number, number, number]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from([...a, ...b]), 3));
      return g;
    };
    return {
      x: line(annotations.origin, annotations.xAxisEnd),
      y: line(annotations.origin, annotations.yAxisEnd),
      z: line(annotations.origin, annotations.zAxisEnd),
    };
  }, [annotations]);

  useEffect(
    () => () => {
      geometries.x.dispose();
      geometries.y.dispose();
      geometries.z.dispose();
    },
    [geometries],
  );

  const [minX, minY] = annotations.origin;
  return (
    <group>
      <lineSegments geometry={geometries.x}>
        <lineBasicMaterial color="#e06666" depthTest={false} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={geometries.y}>
        <lineBasicMaterial color="#7bd88f" depthTest={false} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={geometries.z}>
        <lineBasicMaterial color="#6ea8fe" depthTest={false} depthWrite={false} />
      </lineSegments>
      {annotations.x.map((tick) => (
        <TickLabel
          key={`x-${tick.value}`}
          text={tick.label}
          position={[tick.position[0], minY - labelGap, tick.position[2]]}
          orientation="vertical"
          scale={labelScale}
          center={[0.5, 1]}
        />
      ))}
      {annotations.y.map((tick) => (
        <TickLabel
          key={`y-${tick.value}`}
          text={tick.label}
          position={[minX - labelGap, tick.position[1], tick.position[2]]}
          orientation="horizontal"
          scale={labelScale}
          center={[1, 0.5]}
        />
      ))}
      {annotations.z.map((tick) => (
        <TickLabel
          key={`z-${tick.value}`}
          text={tick.label}
          position={[minX - labelGap, minY - labelGap, tick.position[2]]}
          orientation="horizontal"
          scale={labelScale}
          center={[1, 0.5]}
        />
      ))}
    </group>
  );
}

/**
 * Local grid-index (I/J) axes drawn along the two lattice edges meeting at the
 * origin node, with index labels following the same rules as the world axes: I
 * labels below the surface (−Y) written bottom-to-top, J labels left of it (−X).
 * Pushed further out than the world labels so the two sets can be shown together.
 */
function LocalAnnotations({
  annotations,
  labelScale,
  labelGap,
}: {
  annotations: Grid2dLocalAnnotations;
  labelScale: number;
  labelGap: number;
}) {
  const geometries = useMemo(() => {
    const line = (a: [number, number, number], b: [number, number, number]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from([...a, ...b]), 3));
      return g;
    };
    return {
      i: line(annotations.origin, annotations.iAxisEnd),
      j: line(annotations.origin, annotations.jAxisEnd),
    };
  }, [annotations]);

  useEffect(
    () => () => {
      geometries.i.dispose();
      geometries.j.dispose();
    },
    [geometries],
  );

  const [minX, minY] = annotations.origin;
  return (
    <group>
      <lineSegments geometry={geometries.i}>
        <lineBasicMaterial color="#ffb454" depthTest={false} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={geometries.j}>
        <lineBasicMaterial color="#c792ea" depthTest={false} depthWrite={false} />
      </lineSegments>
      {annotations.i.map((tick) => (
        <TickLabel
          key={`i-${tick.index}`}
          text={tick.label}
          position={[tick.position[0], minY - labelGap, tick.position[2]]}
          orientation="vertical"
          scale={labelScale}
          center={[0.5, 1]}
        />
      ))}
      {annotations.j.map((tick) => (
        <TickLabel
          key={`j-${tick.index}`}
          text={tick.label}
          position={[minX - labelGap, tick.position[1], tick.position[2]]}
          orientation="horizontal"
          scale={labelScale}
          center={[1, 0.5]}
        />
      ))}
    </group>
  );
}

export default function Grid2dSurfaceView({ surface }: { surface: Grid2dSurface }) {
  const [colormap, setColormap] = useState<ColormapName>("viridis");
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showWorldAxes, setShowWorldAxes] = useState(true);
  const [showLocalAxes, setShowLocalAxes] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [zScale, setZScale] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [view, setView] = useState<ViewPreset>("default");
  const hasWebgl = useMemo(webglAvailable, []);

  const applyView = (nextView: ViewPreset) => {
    setView(nextView);
    setResetKey((value) => value + 1);
  };

  const domain = useMemo(() => robustDomain(surface.z), [surface]);
  const mesh = useMemo(() => buildGrid2dMesh(surface, zScale), [surface, zScale]);
  const colors = useMemo(
    () => mapScalarsToColors(surface.z, domain, colormap),
    [surface, domain, colormap],
  );
  const gridLines = useMemo(
    () => buildGrid2dGridLines(surface, mesh.positions),
    [surface, mesh],
  );
  const axisAnnotations = useMemo(
    () => buildGrid2dAxisAnnotations(mesh, surface, zScale),
    [mesh, surface, zScale],
  );
  const localAnnotations = useMemo(
    () => buildGrid2dLocalAnnotations(surface, mesh.positions),
    [surface, mesh],
  );
  // Origin marker + axis-label sizes derived from the surface extent so they
  // read clearly at any scale. Local (I/J) labels sit further out than the world
  // labels so both sets can be shown at once without overlapping.
  const { markerRadius, labelScale, worldLabelGap, localLabelGap } = useMemo(() => {
    const { min, max } = mesh.bounds;
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    return {
      markerRadius: Math.max(diagonal * 0.012, 1e-6),
      labelScale: Math.max(diagonal * 0.022, 1e-6),
      worldLabelGap: Math.max(diagonal * 0.02, 1e-6),
      localLabelGap: Math.max(diagonal * 0.12, 1e-6),
    };
  }, [mesh]);

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
      <div className="absolute left-2 top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background/85 px-2 py-1.5 backdrop-blur-sm">
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Colormap
          <select
            value={colormap}
            onChange={(event) => setColormap(event.target.value as ColormapName)}
            className="h-6 rounded border border-border/50 bg-background px-1 text-[11px] text-foreground"
          >
            {COLORMAP_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
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
            onChange={(event) => setZScale(Number(event.target.value))}
            className="h-1 w-24 cursor-pointer"
            aria-label="Vertical exaggeration"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setWireframe((value) => !value)}
        >
          {wireframe ? "Solid" : "Wireframe"}
        </Button>
        <Button
          variant={showGrid ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setShowGrid((g) => !g)}
          title="Overlay the I/J row/column lattice; the origin (i=0, j=0) is marked with a sphere and coloured I (red) / J (green) axes"
        >
          {showGrid ? "Hide grid" : "Grid"}
        </Button>
        <Button
          variant={showWorldAxes ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setShowWorldAxes((value) => !value)}
          title="Show world-coordinate tick labels on the X (red), Y (green) and Z (blue) axes"
        >
          {showWorldAxes ? "Hide world" : "World"}
        </Button>
        <Button
          variant={showLocalAxes ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setShowLocalAxes((value) => !value)}
          title="Show local grid-index (I/J) labels along the lattice edges"
        >
          {showLocalAxes ? "Hide local" : "Local"}
        </Button>
        <Button
          variant={autoRotate ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setAutoRotate((r) => !r)}
          title="Slowly rotate the surface (turntable animation)"
        >
          {autoRotate ? "Stop" : "Animate"}
        </Button>
        <Button
          variant={view === "top" ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => applyView("top")}
          title="Look straight down (plan view)"
        >
          Top view
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => applyView("default")}
          title="Reset to oblique 3D view"
        >
          Reset view
        </Button>
      </div>

      <div className="absolute right-2 top-2 z-10">
        <Grid2dColormapLegend
          name={colormap}
          domain={domain}
          label={surface.title || "Elevation"}
          units={surface.units}
        />
      </div>

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
        {showGrid && <GridOverlay lines={gridLines} markerRadius={markerRadius} />}
        {showWorldAxes && (
          <AxisAnnotations
            annotations={axisAnnotations}
            labelScale={labelScale}
            labelGap={worldLabelGap}
          />
        )}
        {showLocalAxes && (
          <LocalAnnotations
            annotations={localAnnotations}
            labelScale={labelScale}
            labelGap={localLabelGap}
          />
        )}
        <SceneControls bounds={mesh.bounds} resetKey={resetKey} view={view} autoRotate={autoRotate} />
      </Canvas>
    </div>
  );
}