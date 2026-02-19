import type { MarbleConfig, MarbleDesignId } from "../../store/gameStore";

const VERTEX_SHADER = `
  precision highp float;
  attribute vec3 position;
  attribute vec3 normal;
  attribute vec2 uv;
  uniform mat4 worldViewProjection;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUV;
  void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vPosition = position;
    vNormal = normal;
    vUV = uv;
  }
`;

function getFragmentShader(designId: MarbleDesignId): string {
  return `
  precision highp float;
  uniform vec3 mainColor;
  uniform vec3 secondaryColor;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUV;
  void main() {
    float mixVal = 0.0;
    ${getMixExpression(designId)}
    vec3 col = mix(mainColor, secondaryColor, clamp(mixVal, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
  `;
}

function getMixExpression(designId: MarbleDesignId): string {
  switch (designId) {
    case 0:
      return "mixVal = 0.0;";
    case 1:
      return "mixVal = sin(vPosition.y * 8.0) * 0.5 + 0.5;";
    case 2:
      return "vec2 p = vUV * 10.0; mixVal = step(0.6, fract(p.x) * fract(p.y));";
    case 3:
      return "mixVal = (vPosition.y + 0.5);";
    case 4:
      return "float angle = atan(vPosition.z, vPosition.x); float r = length(vPosition.xz); mixVal = sin(angle * 2.0 + r * 5.0) * 0.5 + 0.5;";
    default:
      return "mixVal = 0.0;";
  }
}

/**
 * Creates a Babylon.js material for a marble design.
 */
export function createMarbleMaterial(
  BABYLON: typeof import("@babylonjs/core"),
  scene: any,
  config: MarbleConfig,
  name: string,
): any {
  const key = `marbleDesign${config.designId}`;
  const store = (BABYLON.Effect || (BABYLON as any).Effect)?.ShadersStore;
  if (store && !store[`${key}VertexShader`]) {
    store[`${key}VertexShader`] = VERTEX_SHADER;
    store[`${key}FragmentShader`] = getFragmentShader(config.designId);
  }

  const mat = new BABYLON.ShaderMaterial(
    name,
    scene,
    { vertex: key, fragment: key },
    {
      attributes: ["position", "normal", "uv"],
      uniforms: ["world", "worldViewProjection", "mainColor", "secondaryColor"],
    },
  );

  const main = config.mainColor;
  const sec = config.secondaryColor;
  mat.setColor3(
    "mainColor",
    new BABYLON.Color3(main.r / 255, main.g / 255, main.b / 255),
  );
  mat.setColor3(
    "secondaryColor",
    new BABYLON.Color3(sec.r / 255, sec.g / 255, sec.b / 255),
  );

  return mat;
}

export const MARBLE_DESIGNS: { id: MarbleDesignId; name: string }[] = [
  { id: 1, name: "Stripes" },
  { id: 2, name: "Spots" },
  { id: 3, name: "Gradient" },
  { id: 4, name: "Swirl" },
];
