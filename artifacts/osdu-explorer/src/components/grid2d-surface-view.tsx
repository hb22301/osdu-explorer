import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Button } from "@/components/ui/button";
import {
  buildGrid2dMesh,
  buildGrid2dGridLines,
  buildGrid2dAxisAnnotations,
  buildGrid2dEdgeAnnotations,
  type Grid2dSurface,
  type Grid2dGridLines,
  type Grid2dAxisAnnotations,
  type Grid2dEdgeAnnotations,
  type Grid2dEdgeTick,
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
 * Render a short label onto a canvas and wrap it as a sprite texture. `text` may
 * carry several lines separated by "\n", stacked as parallel runs (one above the
 * next for horizontal labels, side by side for vertical ones) so a world
 * coordinate and its local index read as an adjacent two-line pair. Vertical
 * labels bake a bottom-to-top rotation into the canvas so the sprite stays
 * upright (no distortion) while the text reads upward.
 */
function makeLabelTexture(text: string, orientation: LabelOrientation): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const fontSize = 22;
  const font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  context.font = font;
  const lines = text.split("\n");
  const lineLength = Math.ceil(Math.max(...lines.map((line) => context.measureText(line).width))) + 12;
  const lineThickness = fontSize + 8; // thickness of one text run
  const totalThickness = lineThickness * lines.length;
  if (orientation === "vertical") {
    canvas.width = totalThickness;
    canvas.height = lineLength;
  } else {
    canvas.width = lineLength;
    canvas.height = totalThickness;
  }
  // Resizing the canvas resets its context, so re-apply the font/alignment.
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  drawLabelPill(context, canvas.width, canvas.height);
  context.fillStyle = "#e6edf5";
  lines.forEach((line, k) => {
    const shift = (k - (lines.length - 1) / 2) * lineThickness; // centre the stack
    if (orientation === "vertical") {
      context.save();
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(-Math.PI / 2); // reads bottom-to-top
      context.fillText(line, 0, shift + 1);
      context.restore();
    } else {
      context.fillText(line, canvas.width / 2, canvas.height / 2 + shift + 1);
    }
  });

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

  // `scale` sizes one text line; multiplying by the line count keeps each line
  // the same height whether the label is one line or a stacked pair.
  const lineCount = text.split("\n").length;
  const aspect = texture.image.width / texture.image.height;
  const spriteScale: [number, number, number] =
    orientation === "vertical"
      ? [scale * lineCount, (scale * lineCount) / aspect, 1]
      : [scale * lineCount * aspect, scale * lineCount, 1];
  return (
    <sprite ref={spriteRef} position={position} scale={spriteScale}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}

/**
 * Z elevation ruler drawn as a single vertical line at the far (maxX, maxY)
 * corner of the bounding box — away from the origin corner where the X/Y edge
 * labels meet — with world-elevation tick labels (blue). Part of the world CRS
 * annotations, so it is shown together with the world edge labels.
 */
function ElevationRuler({
  annotations,
  labelScale,
  labelGap,
}: {
  annotations: Grid2dAxisAnnotations;
  labelScale: number;
  labelGap: number;
}) {
  const zCorner = annotations.xAxisEnd[0];
  const zCornerY = annotations.yAxisEnd[1];
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(
        Float32Array.from([
          zCorner, zCornerY, annotations.origin[2],
          zCorner, zCornerY, annotations.zAxisEnd[2],
        ]),
        3,
      ),
    );
    return g;
  }, [annotations, zCorner, zCornerY]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#6ea8fe" depthTest={false} depthWrite={false} />
      </lineSegments>
      {annotations.z.map((tick) => (
        <TickLabel
          key={`z-${tick.value}`}
          text={tick.label}
          position={[zCorner + labelGap, zCornerY + labelGap, tick.position[2]]}
          orientation="horizontal"
          scale={labelScale}
          center={[0, 0.5]}
        />
      ))}
    </group>
  );
}

/**
 * The two lattice edges meeting at the origin node, drawn as the surface's X/Y
 * axes (I red, J green). Both coordinate systems are labelled at the SAME node
 * points: at each tick the world coordinate and, adjacent to it (further out
 * along the same outward normal), the local grid index. Because the lattice can
 * be rotated the labels are offset perpendicular to each edge, away from the
 * surface interior, so they clear the footprint; text orientation follows the
 * edge's screen direction so both tracks read the same way.
 */
function EdgeAnnotations({
  annotations,
  showWorld,
  showLocal,
  labelScale,
  labelGap,
}: {
  annotations: Grid2dEdgeAnnotations;
  showWorld: boolean;
  showLocal: boolean;
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

  // Per-edge label geometry: an outward XY normal (perpendicular to the edge,
  // pointing away from the surface interior so labels clear the footprint) and a
  // text orientation taken from the edge's screen direction. A mostly-horizontal
  // edge gets bottom-to-top (vertical) text and a mostly-vertical edge gets
  // horizontal text, so labels sharing a screen edge read the same way even when
  // the lattice is rotated.
  const { iOffset, jOffset, iOrientation, jOrientation } = useMemo(() => {
    const [ox, oy] = annotations.origin;
    const di: [number, number] = [annotations.iAxisEnd[0] - ox, annotations.iAxisEnd[1] - oy];
    const dj: [number, number] = [annotations.jAxisEnd[0] - ox, annotations.jAxisEnd[1] - oy];
    const outwardNormal = (edge: [number, number], interior: [number, number]): [number, number] => {
      const length = Math.hypot(edge[0], edge[1]) || 1;
      let normal: [number, number] = [-edge[1] / length, edge[0] / length];
      if (normal[0] * interior[0] + normal[1] * interior[1] > 0) {
        normal = [-normal[0], -normal[1]];
      }
      return normal;
    };
    const orient = (edge: [number, number]): LabelOrientation =>
      Math.abs(edge[0]) >= Math.abs(edge[1]) ? "vertical" : "horizontal";
    return {
      iOffset: outwardNormal(di, dj),
      jOffset: outwardNormal(dj, di),
      iOrientation: orient(di),
      jOrientation: orient(dj),
    };
  }, [annotations]);

  // Each tick renders one label block offset along the edge's outward normal.
  // The world coordinate and the local index are stacked as two adjacent lines
  // within that block (world first), so they always read together as a pair.
  const pairText = (tick: Grid2dEdgeTick): string => {
    const parts: string[] = [];
    if (showWorld) parts.push(tick.worldLabel);
    if (showLocal) parts.push(tick.indexLabel);
    return parts.join("\n");
  };
  const offsetPosition = (
    tick: Grid2dEdgeTick,
    offset: [number, number],
  ): [number, number, number] => [
    tick.position[0] + offset[0] * labelGap,
    tick.position[1] + offset[1] * labelGap,
    tick.position[2],
  ];

  return (
    <group>
      <lineSegments geometry={geometries.i}>
        <lineBasicMaterial color="#ff5b5b" depthTest={false} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={geometries.j}>
        <lineBasicMaterial color="#4ade80" depthTest={false} depthWrite={false} />
      </lineSegments>
      {annotations.i.map((tick) => (
        <TickLabel
          key={`i-${tick.index}`}
          text={pairText(tick)}
          position={offsetPosition(tick, iOffset)}
          orientation={iOrientation}
          scale={labelScale}
          center={[0.5, 0.5]}
        />
      ))}
      {annotations.j.map((tick) => (
        <TickLabel
          key={`j-${tick.index}`}
          text={pairText(tick)}
          position={offsetPosition(tick, jOffset)}
          orientation={jOrientation}
          scale={labelScale}
          center={[0.5, 0.5]}
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
  const edgeAnnotations = useMemo(
    () => buildGrid2dEdgeAnnotations(surface, mesh.positions),
    [surface, mesh],
  );
  // Origin marker + axis-label sizes derived from the surface extent so they read
  // clearly at any scale. Each edge tick draws a single two-line block (world
  // coordinate + local index) offset off the edge along its outward normal.
  const { markerRadius, labelScale, worldLabelGap, edgeLabelGap } = useMemo(() => {
    const { min, max } = mesh.bounds;
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    return {
      markerRadius: Math.max(diagonal * 0.012, 1e-6),
      labelScale: Math.max(diagonal * 0.022, 1e-6),
      worldLabelGap: Math.max(diagonal * 0.02, 1e-6),
      edgeLabelGap: Math.max(diagonal * 0.035, 1e-6),
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
          title="Show world-coordinate tick labels along the I/J edges (paired with local indices) plus the Z elevation ruler"
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
        {(showWorldAxes || showLocalAxes) && (
          <EdgeAnnotations
            annotations={edgeAnnotations}
            showWorld={showWorldAxes}
            showLocal={showLocalAxes}
            labelScale={labelScale}
            labelGap={edgeLabelGap}
          />
        )}
        {showWorldAxes && (
          <ElevationRuler
            annotations={axisAnnotations}
            labelScale={labelScale}
            labelGap={worldLabelGap}
          />
        )}
        <SceneControls bounds={mesh.bounds} resetKey={resetKey} view={view} autoRotate={autoRotate} />
      </Canvas>
    </div>
  );
}