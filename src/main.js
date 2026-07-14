import * as THREE from "three";
import gsap from "gsap";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { toggleAmbient } from "./audio.js";
import { initIntro } from "./intro.js";
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  NoiseEffect,
  DepthOfFieldEffect,
  ToneMappingEffect,
  ToneMappingMode,
  BlendFunction,
} from "postprocessing";
import {
  scene,
  camera,
  initWorld,
  updateWorld,
} from "./world.js";

const canvas = document.querySelector("#canvas");

// Safariの時はロゴのsvgフィルターを外す
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

if (isSafari) {
  document.documentElement.classList.add('is-safari');
}

const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: false,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.3));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;

//! ポストプロセス
const composer = new EffectComposer(renderer, {
  frameBufferType: THREE.HalfFloatType, // ★HDRを有効化（これがないとBloomやACESが死にます）
  multisampling: 2,
});
composer.addPass(new RenderPass(scene, camera));

//* ブルーム
const bloomEffect = new BloomEffect({
  intensity: 1.0,
  luminanceThreshold: 0.8,
  luminanceSmoothing: 0.1,
  mipmapBlur: true,
});

//* グレイン
const noiseEffect = new NoiseEffect({
  blendFunction: BlendFunction.OVERLAY,
  premultiply: true,
});
noiseEffect.blendMode.opacity.value = 0.45;

//* ボケ
const BASE_BOKEH_SCALE = 2;
const INTRO_BOKEH_SCALE = 20;

const dofEffect = new DepthOfFieldEffect(camera, {
  bokehScale: INTRO_BOKEH_SCALE,
  focusDistance: 12.1, // ワールド距離
  focusRange: 1, // ピントの合う幅
  resolutionScale: 0.4, // 品質
});

//* トーンマッピング
const toneMappingEffect = new ToneMappingEffect({
  mode: ToneMappingMode.ACES_FILMIC,
});
renderer.toneMappingExposure = 1.2;

const effectPass = new EffectPass(
  camera,
  dofEffect,
  bloomEffect,
  toneMappingEffect,
  noiseEffect,
);
composer.addPass(effectPass);

//! 世界が見える瞬間の演出（DoFラックフォーカス + プッシュアウト）
function playWorldRevealAnimation() {
  
  gsap.to(dofEffect, {
    bokehScale: BASE_BOKEH_SCALE,
    duration: 2.3,
    ease: "power2.out",
  });
 
  gsap.to("#canvas", {
    scale: 1,
    duration: 2.3,
    ease: "power2.out",
  });
}
 
// intro.js側から発火される。main.js側の内部構成をintro.jsに知らせないための疎結合構成。
window.addEventListener("loading-complete", playWorldRevealAnimation, {
  once: true,
});

//! カメラ調整（アスペクト比ブレークポイント）
function adjustCamera(width, height) {
  const aspect = width / height;
  camera.aspect = aspect;
  const config = {
    mobile: {
      fov: 45,
      x: -3,
      y: 1,
      z: 5,
      focusDistance: 10.0,
      focusRange: 5.4,
      grainOpacity: 0.15,
    },
    desktop: {
      fov: 40,
      x: 0,
      y: 1.5,
      z: 7.8,
      focusDistance: 11.3,
      focusRange: 3.7,
      grainOpacity: 0.45,
    },
    ultrawide: {
      fov: 30,
      x: 0,
      y: 1.5,
      z: 7.8,
      focusDistance: 11.3,
      focusRange: 3.7,
      grainOpacity: 0.45,
    },
  };
  const minAspect = 1.77;
  const maxAspect = 2.5;
  let targetFov, targetX, targetY, targetZ;
  let targetFocusDistance, targetFocusRange, targetGrainOpacity;
  if (aspect < 1) {
    // 1. スマホ・縦長画面
    targetFov = config.mobile.fov;
    targetX = config.mobile.x;
    targetY = config.mobile.y;
    targetZ = config.mobile.z;
    targetFocusDistance = config.mobile.focusDistance;
    targetFocusRange = config.mobile.focusRange;
    targetGrainOpacity = config.mobile.grainOpacity;
  } else if (aspect <= minAspect) {
    // 2. 標準的なPC画面（16:9以下）
    targetFov = config.desktop.fov;
    targetX = config.desktop.x;
    targetY = config.desktop.y;
    targetZ = config.desktop.z;
    targetFocusDistance = config.desktop.focusDistance;
    targetFocusRange = config.desktop.focusRange;
    targetGrainOpacity = config.desktop.grainOpacity;
  } else if (aspect >= maxAspect) {
    // 3. ウルトラワイド（21:9以上）
    targetFov = config.ultrawide.fov;
    targetX = config.ultrawide.x;
    targetY = config.ultrawide.y;
    targetZ = config.ultrawide.z;
    targetFocusDistance = config.ultrawide.focusDistance;
    targetFocusRange = config.ultrawide.focusRange;
    targetGrainOpacity = config.ultrawide.grainOpacity;
  } else {
    // 4. 標準〜ワイドの間（滑らかに補間）
    //* t = 0はデスクトップ、 t = 1はウルトラワイド、 t = 0.5はちょうど中間
    //* tとは標準とワイドの間のどのへんにいるかを報告する係（ 0〜1 ）。
    //* lerp関数：報告を受けて、その場所にぴったりの「中間の数字」を算出する計算機。
    const t = (aspect - minAspect) / (maxAspect - minAspect);
    // 線形補間の計算関数
    const lerp = (start, end, t) => start + (end - start) * t;
    targetFov = lerp(config.desktop.fov, config.ultrawide.fov, t);
    targetX = lerp(config.desktop.x, config.ultrawide.x, t);
    targetY = lerp(config.desktop.y, config.ultrawide.y, t);
    targetZ = lerp(config.desktop.z, config.ultrawide.z, t);
    targetFocusDistance = lerp(
      config.desktop.focusDistance,
      config.ultrawide.focusDistance,
      t,
    );
    targetFocusRange = lerp(
      config.desktop.focusRange,
      config.ultrawide.focusRange,
      t,
    );
    targetGrainOpacity = lerp(
      config.desktop.grainOpacity,
      config.ultrawide.grainOpacity,
      t,
    );
  }
  // もし、アスペクト比が 2.5 を超えたら...
  if (aspect > 2.5) {
    const vFovRad = (config.ultrawide.fov * Math.PI) / 180;
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * maxAspect);
    // 固定した横幅を維持するために、現在のアスペクト比に合わせて縦のFOVを逆算する
    targetFov = (2 * Math.atan(Math.tan(hFovRad / 2) / aspect) * 180) / Math.PI;
    // 位置はウルトラワイドの設定をそのまま使用
    targetX = config.ultrawide.x;
    targetY = config.ultrawide.y;
    targetZ = config.ultrawide.z;
    targetFocusDistance = config.ultrawide.focusDistance;
    targetFocusRange = config.ultrawide.focusRange;
    targetGrainOpacity = config.ultrawide.grainOpacity;
  }
  // カメラに値を適用
  camera.fov = targetFov;
  camera.position.set(targetX, targetY, targetZ);
  // ルックアット
  camera.lookAt(0.5, 2.5, 0);
  // 行列を更新（これを忘れると反映されない）
  camera.updateProjectionMatrix();
  // ボケ・グレインに値を適用
  dofEffect.cocMaterial.focusDistance = targetFocusDistance;
  dofEffect.cocMaterial.focusRange = targetFocusRange;
  noiseEffect.blendMode.opacity.value = targetGrainOpacity;
}

//! WASDによる視点回転（頭を振り向ける動き）
const lookClock = new THREE.Clock();
const lookTarget = new THREE.Vector3(0, 0, 0);

// ↓ 毎フレーム使い回す再利用オブジェクト（ループ内でnewしない）
const _baseDir = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _yawAxis = new THREE.Vector3(0, 1, 0);
const _yawQuat = new THREE.Quaternion();
const _pitchQuat = new THREE.Quaternion();
const _lookAtPoint = new THREE.Vector3();

// velocityは素の数値のまま持たせる（{value}でラップしない）
const lookVelocity = { yaw: 0, pitch: 0 };

const LOOK_LIMITS = {
  yawLeft: 5,
  yawRight: 5,
  pitchUp: 20,
  pitchDown: 3,
};

const LOOK_SMOOTH_TIME = 0.65;

let currentYaw = 0;
let currentPitch = 0;

const pressedKeys = new Set();

window.addEventListener("keydown", (e) => {
  pressedKeys.add(e.key.toLowerCase());
});
window.addEventListener("keyup", (e) => {
  pressedKeys.delete(e.key.toLowerCase());
});

function getTargetYawPitch() {
  let targetYaw = currentYaw;
  let targetPitch = currentPitch;

  if (pressedKeys.has("a") && !pressedKeys.has("d")) {
    targetYaw = LOOK_LIMITS.yawLeft;
  } else if (pressedKeys.has("d") && !pressedKeys.has("a")) {
    targetYaw = -LOOK_LIMITS.yawRight;
  }

  if (pressedKeys.has("w") && !pressedKeys.has("s")) {
    targetPitch = LOOK_LIMITS.pitchUp;
  } else if (pressedKeys.has("s") && !pressedKeys.has("w")) {
    targetPitch = -LOOK_LIMITS.pitchDown;
  }

  return { targetYaw, targetPitch };
}

// velocityを引数で受け取り、書き換えて返すだけ（オブジェクト生成なし）
function smoothDampValue(current, target, velocityObj, velocityKey, smoothTime, deltaTime) {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * deltaTime;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  let change = current - target;
  const originalTarget = target;

  const temp = (velocityObj[velocityKey] + omega * change) * deltaTime;
  velocityObj[velocityKey] = (velocityObj[velocityKey] - omega * temp) * exp;
  let output = target + (change + temp) * exp;

  if (originalTarget - current > 0 === output > originalTarget) {
    output = originalTarget;
    velocityObj[velocityKey] = deltaTime > 0 ? (output - originalTarget) / deltaTime : 0;
  }

  return output;
}

function updateLookAround(delta) {
  const { targetYaw, targetPitch } = getTargetYawPitch();

  currentYaw = smoothDampValue(currentYaw, targetYaw, lookVelocity, "yaw", LOOK_SMOOTH_TIME, delta);
  currentPitch = smoothDampValue(currentPitch, targetPitch, lookVelocity, "pitch", LOOK_SMOOTH_TIME, delta);

  // 再利用オブジェクトに値を入れ直す（newしない）
  _baseDir.copy(lookTarget).sub(camera.position).normalize();

  _yawQuat.setFromAxisAngle(_yawAxis, THREE.MathUtils.degToRad(currentYaw));
  _dir.copy(_baseDir).applyQuaternion(_yawQuat);

  _right.crossVectors(_dir, _yawAxis).normalize();
  _pitchQuat.setFromAxisAngle(_right, THREE.MathUtils.degToRad(currentPitch));
  _dir.applyQuaternion(_pitchQuat);

  _lookAtPoint.copy(camera.position).add(_dir);
  camera.lookAt(_lookAtPoint);
}

initWorld(canvas);
initIntro();
adjustCamera(window.innerWidth, window.innerHeight);

window.addEventListener("resize", () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.updateProjectionMatrix()
  adjustCamera(window.innerWidth, window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.3));
  composer.setSize(window.innerWidth, window.innerHeight);
});

//! クリック / 長押し判定（環境音・プレイヤー表示）
const LONG_PRESS_THRESHOLD = 450; // ms

let pressTimer = null;
let longPressTriggered = false;
let startPoint = { x: 0, y: 0 };

function clearPressTimer() {
  clearTimeout(pressTimer);
  pressTimer = null;
}

function onPointerDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return; // 左クリック以外は無視

  longPressTriggered = false;

  startPoint = { x: e.clientX, y: e.clientY };
  
  pressTimer = setTimeout(() => {
    longPressTriggered = true;
    toggleAmbient();
  }, LONG_PRESS_THRESHOLD);
}

function onPointerMove(e) {
  if (!pressTimer) return;

  // 指が一定ピクセル以上動いたら「スクロールやスワイプ操作」とみなして長押しをキャンセル
  const moveThreshold = 10; // 許容するブレ（ピクセル）
  const distX = Math.abs(e.clientX - startPoint.x);
  const distY = Math.abs(e.clientY - startPoint.y);

  if (distX > moveThreshold || distY > moveThreshold) {
    clearPressTimer();
  }
}

function onPointerUp(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;

  clearPressTimer();
  if (!longPressTriggered) {
    togglePlayerBox();
  }
}

function onPointerCancelOrLeave() {
  clearPressTimer();
}

function togglePlayerBox() {
  const box = document.querySelector("#player-box");
  if (!box) return;

  const blurElement = document.querySelector("#misty-player feGaussianBlur");
  const matrixElement = document.querySelector("#misty-player feColorMatrix");

  const isOpening = !box.classList.contains("visible");
  box.classList.toggle("visible");

  gsap.killTweensOf([box, blurElement, matrixElement]);

  if (isOpening) {
    box.style.visibility = "visible";

    gsap.to(box, { opacity: 0.7, duration: 1.2, ease: "power2.out" });
    gsap.to(blurElement, {
      attr: { stdDeviation: 0 },
      duration: 1,
      ease: "power2.out",
    });

    const proxy = { contrast: 70, bias: -10 };
    gsap.to(proxy, {
      contrast: 1,
      bias: 0,
      duration: 1,
      ease: "power2.out",
      onUpdate: () =>
        matrixElement.setAttribute(
          "values",
          `0.5 0 0.6 0 0  0 1.5 0 0 0  0 0 1.9 0 0  0 1 0 ${proxy.contrast} ${proxy.bias}`,
        ),
    });
  } else {
    gsap.to(box, {
      opacity: 0,
      duration: 0.8,
      ease: "power2.in",
      onComplete: () => {
        box.style.visibility = "hidden";
      },
    });
    gsap.to(blurElement, {
      attr: { stdDeviation: 10 },
      duration: 0.8,
      ease: "power2.in",
    });

    const proxy = { contrast: 1, bias: 0 };
    gsap.to(proxy, {
      contrast: 45,
      bias: -5,
      duration: 0.8,
      ease: "power2.in",
      onUpdate: () =>
        matrixElement.setAttribute(
          "values",
          `0.5 0 0.6 0 0  0 1.5 0 0 0  0 0 1.9 0 0  0 0 0 ${proxy.contrast} ${proxy.bias}`,
        ),
    });
  }
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointerleave", onPointerCancelOrLeave);
canvas.addEventListener("pointercancel", onPointerCancelOrLeave);

//! ウィジェットをクリックしたらフォーカスをキャンバスに戻す(ウィジェットクリック後、wasdを使用可能にするため)
const playerIframe = document.querySelector('#player-box iframe');

window.addEventListener("blur", () => {
  if (document.activeElement === playerIframe) {
    requestAnimationFrame(() => {
      canvas.focus();
    });
  }
});


//! tick関数
function tick() {
  updateWorld();

  const delta = lookClock.getDelta();
  updateLookAround(delta);

  composer.render();

  requestAnimationFrame(tick);
}

tick();
