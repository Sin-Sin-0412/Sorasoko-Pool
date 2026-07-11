import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { cloudMaterial } from "./shader.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { initSunFlicker } from "./animation.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import GUI from "lil-gui";

export const scene = new THREE.Scene();
export const gui = new GUI();
gui.close();

//! ローディング管理（intro.js側のローディング画面がこれを監視する）
export const loadingManager = new THREE.LoadingManager();
loadingManager.onError = (url) => {
  console.error(`[loadingManager] 読み込みに失敗しました: ${url}`);
};

//! カメラ
export const camera = new THREE.PerspectiveCamera(
  40,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 1.5, 7.8);

//! 変数
export let controls;
export let water;
export let mixer;

const clock = new THREE.Clock();
const actions = {};
let isInterrupting = false;

//! 鳥
let birdAction = null;
let birdTimer = THREE.MathUtils.randFloat(5.0, 15.0); // 最初の飛来までの待機時間（秒）
let isBirdFlying = false;

const BIRD_MIN_INTERVAL = 40; // 次の飛来までの最短待機時間（秒）
const BIRD_MAX_INTERVAL = 180; // 最長待機時間（秒）

// 木の形状固定のための疑似乱数
function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

//* 「揺れる頂点シェーダー」を差し込む関数を作る工場（木の葉・草など、揺らしたい対象すべてで共有する）
//* 渡されたuniformsオブジェクトを見た目用マテリアルと影用マテリアルの両方に同じ参照で紐付けることで、
//* 揺れがズレない・updateWorld側の更新も1箇所で済む、という状態を作れる
function createWindSwayInjector(uniforms) {
  return (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWindStrength;
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
        #include <begin_vertex>
        // uv.yを利用し、上部の頂点(uv.y > 0.5)だけを綺麗に揺らす（根本は固定）
        float wave = sin(uTime * 3.0 + position.x * 2.0 + position.y) * uWindStrength * step(0.5, uv.y);
        transformed.x += wave;
        transformed.z += wave;
      `,
    );
  };
}

const leafMaterials = [];
const leafClock = new THREE.Clock();

// 風のランダム強弱
let windStrength = 0.02; //* 現在の風の強さ（初期値は微風）
let windState = "calm"; //* 状態管理: "calm"(微風), "rise"(突風が強まる), "fall"(突風が弱まる)
let windTimer = THREE.MathUtils.randFloat(6.0, 12.0); //* 最初の突風が吹くまでの時間（6〜12秒の間でランダム）
let gustMaxStrength = 0.0; //* 突風ごとの最大風速（毎回ランダムに変える）

let hemiLight, dirLight1, dirLight2;
let hemiLightHelper, dirLight1Helper, dirLight2Helper, dirLight1ShadowHelper;

export function initWorld(canvas) {
  // メインカメラに通常描画を許可
  camera.layers.enable(0);

  //! オービット（開発用・最終的に削除）
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  //! フォグ
  scene.fog = new THREE.Fog(0x7ea59f, 10, 100);

  //! ライト
  hemiLight = new THREE.HemisphereLight(0xa5bdc0, 0x615d51, 1.0);
  scene.add(hemiLight);

  dirLight1 = new THREE.DirectionalLight(0xc7dee6, 0.76);
  dirLight1.position.set(-8.5, 16.9, -31.4);
  dirLight1.castShadow = true;
  dirLight1.shadow.mapSize.width = 2048;
  dirLight1.shadow.mapSize.height = 2048;
  dirLight1.shadow.camera.near = 0.5;
  dirLight1.shadow.camera.far = 50;
  dirLight1.shadow.camera.left = -15;
  dirLight1.shadow.camera.right = 15;
  dirLight1.shadow.camera.top = 15;
  dirLight1.shadow.camera.bottom = -15;
  dirLight1.shadow.bias = -0.0003;
  dirLight1.shadow.normalBias = 0.012;
  dirLight1.shadow.radius = 3.6;
  scene.add(dirLight1);

  dirLight2 = new THREE.DirectionalLight(0xded2f9, 0.84); //* d2d4f9
  dirLight2.position.set(-5, 4.2, -4.7);
  scene.add(dirLight2);

  //! ヘルパー
  hemiLightHelper = new THREE.HemisphereLightHelper(hemiLight, 1);
  hemiLightHelper.visible = false;
  scene.add(hemiLightHelper);

  dirLight1Helper = new THREE.DirectionalLightHelper(dirLight1, 1);
  dirLight1Helper.visible = true;
  scene.add(dirLight1Helper);

  dirLight1ShadowHelper = new THREE.CameraHelper(dirLight1.shadow.camera);
  dirLight1ShadowHelper.visible = true;
  scene.add(dirLight1ShadowHelper);

  dirLight2Helper = new THREE.DirectionalLightHelper(dirLight2, 1);
  dirLight2Helper.visible = true;
  scene.add(dirLight2Helper);

  //! 実写背景
  const textureLoader = new THREE.TextureLoader(loadingManager);
  const bgTexture = textureLoader.load("/image/haikei02.jpg");
  bgTexture.colorSpace = THREE.SRGBColorSpace;

  const bgGeometry = new THREE.CylinderGeometry(
    80,
    80,
    40,
    64,
    1,
    true,
    0,
    Math.PI / 2.5,
  );

  const bgMaterial = new THREE.MeshBasicMaterial({
    map: bgTexture,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });

  const bgMesh = new THREE.Mesh(bgGeometry, bgMaterial);
  bgMesh.position.set(0, 9, 30);
  bgMesh.rotation.y = Math.PI / 1.277;
  bgMesh.renderOrder = -1;
  scene.add(bgMesh);

  const cloudGeometry = new THREE.SphereGeometry(
    75,
    32,
    15,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
  cloudMesh.position.set(0, 7, 20); // 街並みに合わせる
  cloudMesh.renderOrder = -0.5;
  scene.add(cloudMesh);

  //! ★ 雲の調整用GUI
  const cloudFolder = gui.addFolder("天空の雲設定");
  const cloudParams = {
    skyTop: cloudMaterial.uniforms.skyColorTop.value.getHex(),
    skyBottom: cloudMaterial.uniforms.skyColorBottom.value.getHex(),
    baseColor: cloudMaterial.uniforms.cloudBaseColor.value.getHex(),
    shadowColor: cloudMaterial.uniforms.cloudShadowColor.value.getHex(),
  };
  cloudFolder
    .addColor(cloudParams, "skyTop")
    .name("空の上部色")
    .onChange((v) => cloudMaterial.uniforms.skyColorTop.value.setHex(v));
  cloudFolder
    .addColor(cloudParams, "skyBottom")
    .name("空の下部色")
    .onChange((v) => cloudMaterial.uniforms.skyColorBottom.value.setHex(v));
  cloudFolder
    .addColor(cloudParams, "baseColor")
    .name("雲の光る色")
    .onChange((v) => cloudMaterial.uniforms.cloudBaseColor.value.setHex(v));
  cloudFolder
    .addColor(cloudParams, "shadowColor")
    .name("雲の影色")
    .onChange((v) => cloudMaterial.uniforms.cloudShadowColor.value.setHex(v));

  // 1. cloudScale (雲の大きさ)
  cloudFolder
    .add(cloudMaterial.uniforms.cloudScale, "value", 0.1, 15.0)
    .step(0.01)
    .name("雲の大きさ");

  // 2. cloudSpeed (流れる速度)
  cloudFolder
    .add(cloudMaterial.uniforms.cloudSpeed, "value", -0.05, 0.05)
    .step(0.001)
    .name("流れる速度");

  // 3. cloudCutoff (雲の少なさ)
  cloudFolder
    .add(cloudMaterial.uniforms.cloudCutoff, "value", 0.0, 1.0)
    .step(0.01)
    .name("雲の少なさ(しきい値)");

  // 4. cloudSmoothness (フチのボケ具合)
  cloudFolder
    .add(cloudMaterial.uniforms.cloudSmoothness, "value", 0.001, 0.2)
    .step(0.001)
    .name("フチのボケ具合");

  //! モデル読み込み
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
  );

  const loader = new GLTFLoader(loadingManager);
  loader.setDRACOLoader(dracoLoader);
  loader.load("/model/pool.glb", (gltf) => {
    const model = gltf.scene;
    model.rotation.y = Math.PI;
    model.scale.setScalar(0.3);
    model.position.set(0, 0, 6);

    // アニメーション
    mixer = new THREE.AnimationMixer(model);
    gltf.animations.forEach((clip) => {
      actions[clip.name] = mixer.clipAction(clip);
    });

    if (actions["sit"]) {
      actions["sit"].play();
    }

    // 鳥アニメーション
    const birdObject = model.getObjectByName("bird");
    if (birdObject && actions["bird"]) {
      birdObject.traverse((child) => {
        if (child.isMesh || child.isSkinnedMesh) {
          child.frustumCulled = false;
        }
      });

      birdAction = actions["bird"];
      birdAction.setLoop(THREE.LoopOnce, 1);
      birdAction.clampWhenFinished = true;
    }

    //! 割り込みアニメーション
    const INTERRUPT_CONFIGS = [
      { name: "yoko", minTime: 30000, maxTime: 60000 },
      { name: "hiza", minTime: 45000, maxTime: 90000 },
      { name: "lie", minTime: 120000, maxTime: 300000, oneTime: true },
      { name: "swing", minTime: 20000, maxTime: 25000 },
    ];

    //* 直前に再生したものを記録
    let lastInterruptName = null;

    //* 一度きりのアニメーションで、既に再生済みのものの名前を記録
    const usedOneTimeNames = new Set();

    //* アニメーションgui
    const interruptFolder = gui.addFolder("割り込みアニメーション間隔");
    INTERRUPT_CONFIGS.forEach((config) => {
      const folder = interruptFolder.addFolder(config.name);
      folder.add(config, "minTime", 1000, 200000).step(500).name("最短(ms)");
      folder.add(config, "maxTime", 1000, 200000).step(500).name("最長(ms)");
    });

    //* 次の割り込みをランダムに選んで予約する共通のタイマー関数
    const scheduleNextInterrupt = () => {
      //* 直前と同じものを除いた候補から選ぶ（候補が1つしかない場合は除外しない）
      //* 直前と同じもの、かつ「一度きり」で既出のものを除いた候補から選ぶ
      const candidates = INTERRUPT_CONFIGS.filter((c) => {
        if (c.oneTime && usedOneTimeNames.has(c.name)) return false; // 使用済みの一度きりは除外
        if (c.name === lastInterruptName) return false; // 直前と同じものは除外
        return true;
      });

      //* 候補が0件（全部使い果たした等）の場合は、直前除外だけ緩めて再抽選
      const pool =
        candidates.length > 0
          ? candidates
          : INTERRUPT_CONFIGS.filter(
              (c) => !(c.oneTime && usedOneTimeNames.has(c.name)),
            );

      //* それでも0件なら（理論上ほぼ無いが安全策）、全アニメーションから選ぶ
      const finalPool = pool.length > 0 ? pool : INTERRUPT_CONFIGS;

      //* 候補の中からランダムに1つ選ぶ
      const config = finalPool[Math.floor(Math.random() * finalPool.length)];

      const delay = THREE.MathUtils.randFloat(config.minTime, config.maxTime);

      setTimeout(() => {
        //* もし何かの手違いですでに再生中だったり、アクションがない場合は再抽選して終了
        if (isInterrupting || !actions[config.name]) {
          scheduleNextInterrupt();
          return;
        }

        isInterrupting = true;
        lastInterruptName = config.name;
        if (config.oneTime) usedOneTimeNames.add(config.name); // ← ここで「使用済み」として記録

        const action = actions[config.name];
        const sitAction = actions["sit"];

        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;

        action.play();
        action.crossFadeFrom(sitAction, 0.5, false);
      }, delay);
    };

    //* アニメーション終了時のイベント
    mixer.addEventListener("finished", (e) => {
      const finishedAction = e.action;

      if (finishedAction === birdAction) {
        isBirdFlying = false;
        birdTimer = THREE.MathUtils.randFloat(
          BIRD_MIN_INTERVAL,
          BIRD_MAX_INTERVAL,
        );
        return;
      }

      const sitAction = actions["sit"];

      sitAction.reset().play();
      sitAction.crossFadeFrom(finishedAction, 0.5, false);

      isInterrupting = false;

      //* 割り込みが終わって「sit」に戻った【直後】から、次の割り込みのカウントダウンを始める
      scheduleNextInterrupt();
    });

    //* ページを読み込んだ最初の一回目だけ、タイマーを起動する
    scheduleNextInterrupt();

    // モデル全体の行列（回転・スケール・位置）を確定
    model.updateMatrixWorld(true);

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }

      //* 窓枠
      if (child.isMesh && child.name.includes("window_frame")) {
        child.material = child.material.clone();
        child.material.metalness = 0.7;
        child.material.roughness = 0.1;
      }

      //* 窓ガラス
      if (child.isMesh && child.name.includes("window_glass")) {
        child.material = child.material.clone();
        child.material.metalness = 0.5;
        child.material.roughness = 0.3;
        child.material.transparent = true;
        child.material.opacity = 0.7;
      }

      //* 地面
      if (child.isMesh && child.name.includes("ground")) {
        child.material = child.material.clone();
        child.material.metalness = 0.2;
        child.material.roughness = 0.7;
      }

      //* プール
      if (child.isMesh && child.name.includes("pool")) {
        child.material = child.material.clone();
        child.material.metalness = 0.4;
        child.material.roughness = 0.8;
      }

      //* プールはしご
      if (child.isMesh && child.name.includes("hashigo")) {
        child.material = child.material.clone();
        child.material.metalness = 0.5;
        child.material.roughness = 0.4;
      }

      //* 監視椅子
      if (child.isMesh && child.name.includes("high-chair")) {
        child.material = child.material.clone();
        child.material.metalness = 0.4;
        child.material.roughness = 0.7;
      }

      //* プール屋根
      if (child.isMesh && child.name.includes("pool-roof")) {
        child.material = child.material.clone();
        child.material.metalness = 0.1;
        child.material.roughness = 0.5;
      }

      //* プール建物
      if (child.isMesh && child.name.includes("pool-wall")) {
        child.material = child.material.clone();
        child.material.metalness = 0.1;
        child.material.roughness = 0.5;
      }

      //* プール建物ブロック
      if (child.isMesh && child.name.includes("block")) {
        child.material = child.material.clone();
        child.material.metalness = 0.2;
        child.material.roughness = 0.7;
      }

      //* 学校隣屋根
      if (child.isMesh && child.name.includes("side-roof")) {
        child.material = child.material.clone();
        child.material.metalness = 0.4;
        child.material.roughness = 0.7;
      }

      //* 柵
      if (child.isMesh && child.name.includes("saku")) {
        child.material = child.material.clone();
        child.material.metalness = 0.1;
        child.material.roughness = 0.6;
      }

      //* ガードレール
      if (child.isMesh && child.name.includes("guardrail")) {
        child.material = child.material.clone();
        child.material.metalness = 0.3;
        child.material.roughness = 0.7;
      }

      //* プールの水面
      if (child.isMesh && child.name === "water") {
        const worldPosition = new THREE.Vector3();
        child.getWorldPosition(worldPosition);

        // BoundingBoxを使ってワールド空間での実際の寸法（幅と奥行き）を測る
        const box = new THREE.Box3().setFromObject(child);
        const width = box.max.x - box.min.x;
        const depth = box.max.z - box.min.z;

        child.visible = false;

        const waterGeometry = new THREE.PlaneGeometry(width, depth);

        water = new Water(waterGeometry, {
          textureWidth: 768,
          textureHeight: 768,
          waterNormals: textureLoader.load("image/water05.jpg", (texture) => {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          }),
          sunDirection: dirLight1.position.clone().normalize(),
          waterColor: 0x395f60,
          sunColor: 0xe6efef,
          distortionScale: 0.25,
          size: 0.3,
          alpha: 0.92,
          fog: scene.fog !== undefined,
        });

        // Z向きの板を90度倒して水平にする（Water.jsが想定する正しい向き
        water.rotation.x = -Math.PI / 2;

        water.position.copy(worldPosition);

        // ★ 水面の調整用GUIを動的に追加
        const waterFolder = gui.addFolder("水面設定");

        // 既存のライトやフォグと同じ、確実な getHex スタイルに統一
        const waterParams = {
          waterColor: water.material.uniforms.waterColor.value.getHex(),
          sunColor: water.material.uniforms.sunColor.value.getHex(),
        };

        // カラーピッカー（変更時に setHex でシェーダーに安全に流し込む）
        waterFolder
          .addColor(waterParams, "waterColor")
          .name("水の色")
          .onChange((v) => {
            water.material.uniforms.waterColor.value.setHex(v);
          });

        waterFolder
          .addColor(waterParams, "sunColor")
          .name("太陽光の反射色")
          .onChange((v) => {
            water.material.uniforms.sunColor.value.setHex(v);
          });

        // 数値の調整
        waterFolder
          .add(water.material.uniforms.distortionScale, "value", 0, 10)
          .step(0.1)
          .name("波の歪み強さ");
        waterFolder
          .add(water.material.uniforms.size, "value", 0.01, 10)
          .step(0.01)
          .name("波の細かさ(size)");
        waterFolder
          .add(water.material.uniforms.alpha, "value", 0, 1)
          .step(0.01)
          .name("不透明度(alpha)");

        // マテリアル自体の透明化フラグをオンにする
        water.material.transparent = true;

        scene.add(water);

        //! 太陽光と水面の数値
        initSunFlicker(dirLight1, water, {
          baseIntensity: 0.76,
          maxIntensity: 5.5,
          baseAlpha: 0.92,
          minAlpha: 0.72,
        });
      }
    });

    //! 木の実装ロジック
    const trunkMesh = model.getObjectByName("Tree_Trunk");
    const guideSphere = model.getObjectByName("Tree_Leaf_Guide");
    const leafBaseMesh = model.getObjectByName("Leaf_Base");

    if (trunkMesh && guideSphere && leafBaseMesh) {
      //* 元のガイド球体と十字メッシュを消す
      guideSphere.visible = false;
      leafBaseMesh.visible = false;

      //* ベースの木構築
      const sphereGeom = guideSphere.geometry;
      const posAttr = sphereGeom.attributes.position;
      const leafGeometries = [];
      const leafCount = 37;

      //* 球体の表面座標からランダムにサンプリングして葉を配置
      for (let i = 0; i < leafCount; i++) {
        const vertexIndex = Math.floor(Math.random() * posAttr.count);
        const lx =
          posAttr.getX(vertexIndex) * guideSphere.scale.x +
          guideSphere.position.x;
        const ly =
          posAttr.getY(vertexIndex) * guideSphere.scale.y +
          guideSphere.position.y;
        const lz =
          posAttr.getZ(vertexIndex) * guideSphere.scale.z +
          guideSphere.position.z;

        //* 十字メッシュコピー
        const clonedGeom = leafBaseMesh.geometry.clone();

        //* 葉ごとのランダムな回転とスケールを計算
        const dummy = new THREE.Object3D();
        dummy.position.set(lx, ly, lz);
        dummy.rotation.set(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        );
        dummy.scale.setScalar(THREE.MathUtils.randFloat(0.8, 1.4));
        dummy.updateMatrix();

        //* 形状自体に変形マトリクスを直接適用
        clonedGeom.applyMatrix4(dummy.matrix);
        leafGeometries.push(clonedGeom);
      }

      //* 大量の葉の形状を「完全に1つのメッシュ」にマージ（超軽量化）
      const mergeLeafGeometry = BufferGeometryUtils.mergeGeometries(
        leafGeometries,
        true,
      );

      // * 葉の専用カスタムマテリアルの作成（風の揺れ）
      const leafMaterial = leafBaseMesh.material.clone();
      leafMaterial.side = THREE.DoubleSide;
      leafMaterial.map.magFilter = THREE.NearestFilter;
      leafMaterial.map.minFilter = THREE.NearestFilter;

      //* シェーダーの書き換えによる風揺れの実装（影にも完全連動）
      const sharedLeafUniforms = {
        uTime: { value: 0 },
        //* 風の強さを動的に変えるための変数（デフォルトは0.02の微風）
        uWindStrength: { value: 0.02 },
      };
      leafMaterials.push(sharedLeafUniforms); // 更新ループ（updateWorld）から参照するために退避

      //* 頂点シェーダーの書き換え内容（見た目用・影用で完全に同じロジックを使う）
      const injectWindSway = createWindSwayInjector(sharedLeafUniforms);

      //* シェーダーの書き換えによる風揺れの実装（見た目用マテリアル）
      leafMaterial.onBeforeCompile = injectWindSway;

      const mergedLeafMesh = new THREE.Mesh(mergeLeafGeometry, leafMaterial);
      mergedLeafMesh.castShadow = true;
      mergedLeafMesh.receiveShadow = true;

      //* 影専用マテリアル
      const leafDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: leafMaterial.map,
        alphaTest: leafMaterial.alphaTest,
      });
      leafDepthMaterial.onBeforeCompile = injectWindSway;

      mergedLeafMesh.customDepthMaterial = leafDepthMaterial;

      //* 幹と結合した葉wpグループ化して「マスターの木」完成
      const masterTreeGroup = new THREE.Group();
      masterTreeGroup.add(trunkMesh.clone());
      masterTreeGroup.add(mergedLeafMesh);

      trunkMesh.visible = false;

      //! 固定座標への自動クローンと形状固定
      const treePositions = [
        { x: -20.0, y: -3.0, z: 33.0 },
        { x: -15.0, y: -4.5, z: 40.0 },
        { x: -22.0, y: -4.5, z: 40.0 },
        { x: -26.0, y: -3.5, z: 27.0 },
        { x: 2.0, y: -12.7, z: 47.0 },
        { x: -19.0, y: -8.0, z: 47.0 },
        { x: 23.0, y: -13.0, z: 47.0 },
        { x: 36.0, y: -13.0, z: 49.0 },
      ];

      const spawnedTrees = [];

      treePositions.forEach((pos, index) => {
        const treeClone = masterTreeGroup.clone();

        // クローンに対して影(customDepthMaterial)をつける
        treeClone.traverse((child) => {
          if (child.isMesh && child.material === leafMaterial) {
            child.customDepthMaterial = leafDepthMaterial;
          }
        });

        const localPos = new THREE.Vector3(pos.x, pos.y, pos.z);
        const worldPos = localPos.clone();
        model.localToWorld(worldPos);
        treeClone.position.copy(worldPos);

        //* シード値（インデックス）に基づく乱数で、リロードしても常に同じ形を保つ
        let seed = index * 15 + 1;
        const seedRotY = seededRandom(seed++) * Math.PI * 2;
        const seedScale = THREE.MathUtils.lerp(0.8, 1.2, seededRandom(seed++));

        treeClone.rotation.y = seedRotY + model.rotation.y;
        treeClone.scale.setScalar(seedScale * model.scale.x);

        //* 元のプールモデル（model）の子要素として追加することで座標系を統一
        scene.add(treeClone);
        spawnedTrees.push(treeClone);
      });
    }

    //! 草の実装ロジック
    //! 草(plant)の実装ロジック
    const dirtMesh = model.getObjectByName("dirt");
    const plantBaseMesh = model.getObjectByName("plant");

    if (dirtMesh && plantBaseMesh) {
      //* 元の草メッシュ（配置用のテンプレート）は非表示にする
      plantBaseMesh.visible = false;

      //* dirt（空き地）は平らという前提で、そのバウンディングボックスのXZ範囲内にランダムに散らす
      dirtMesh.geometry.computeBoundingBox();
      const dirtBox = dirtMesh.geometry.boundingBox;
      const dirtY = dirtBox.max.y; // 平らな地面の上面に草を生やす

      const plantGeometries = [];
      const plantCount = 1050;

      for (let i = 0; i < plantCount; i++) {
        //* dirtのローカル座標系内でランダムなXZ座標を決める
        const px = THREE.MathUtils.lerp(
          dirtBox.min.x,
          dirtBox.max.x,
          Math.random(),
        );
        const pz = THREE.MathUtils.lerp(
          dirtBox.min.z,
          dirtBox.max.z,
          Math.random(),
        );

        //* 草メッシュコピー
        const clonedGeom = plantBaseMesh.geometry.clone();

        //* 草ごとのランダムな向きとスケールを計算（木と違い直立させたいのでY軸回転のみ）
        const dummy = new THREE.Object3D();
        dummy.position.set(px, dirtY, pz);
        dummy.rotation.y = Math.random() * Math.PI * 2;
        dummy.scale.setScalar(THREE.MathUtils.randFloat(0.5, 1.3));
        dummy.updateMatrix();

        //* 形状自体に変形マトリクスを直接適用
        clonedGeom.applyMatrix4(dummy.matrix);
        plantGeometries.push(clonedGeom);
      }

      //* 大量の草の形状を「完全に1つのメッシュ」にマージ（木の葉と同じ軽量化手法）
      const mergePlantGeometry = BufferGeometryUtils.mergeGeometries(
        plantGeometries,
        true,
      );

      //* 草の専用マテリアル
      const plantMaterial = plantBaseMesh.material.clone();
      plantMaterial.side = THREE.DoubleSide;
      if (plantMaterial.map) {
        plantMaterial.map.magFilter = THREE.NearestFilter;
        plantMaterial.map.minFilter = THREE.NearestFilter;
      }

      //* 草専用のuniformを用意（木とは別の実体だが、更新ループは共通のleafMaterials配列に相乗りさせる）
      const sharedPlantUniforms = {
        uTime: { value: 0 },
        uWindStrength: { value: 0.02 },
      };
      leafMaterials.push(sharedPlantUniforms);

      //* 木の葉と全く同じ揺れロジックを使い回す
      const injectPlantWindSway = createWindSwayInjector(sharedPlantUniforms);
      plantMaterial.onBeforeCompile = injectPlantWindSway;

      const mergedPlantMesh = new THREE.Mesh(mergePlantGeometry, plantMaterial);
      mergedPlantMesh.castShadow = true;
      mergedPlantMesh.receiveShadow = true;

      //* 影専用マテリアル（木と同じ理由で必要）
      const plantDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: plantMaterial.map,
        alphaTest: plantMaterial.alphaTest,
      });
      plantDepthMaterial.onBeforeCompile = injectPlantWindSway;
      mergedPlantMesh.customDepthMaterial = plantDepthMaterial;

      //* dirtメッシュのワールド変換（位置・回転・スケール）をそのまま反映し、座標系を一致させる
      dirtMesh.updateMatrixWorld(true);
      mergedPlantMesh.position.copy(
        dirtMesh.getWorldPosition(new THREE.Vector3()),
      );
      mergedPlantMesh.quaternion.copy(
        dirtMesh.getWorldQuaternion(new THREE.Quaternion()),
      );
      mergedPlantMesh.scale.copy(dirtMesh.getWorldScale(new THREE.Vector3()));

      scene.add(mergedPlantMesh);
    }

    scene.add(model);
  });

  //! GUI設定
  const cameraFolder = gui.addFolder("Camera");
  cameraFolder
    .add(camera.position, "x")
    .min(-50)
    .max(50)
    .step(0.1)
    .name("Position X")
    .listen();
  cameraFolder
    .add(camera.position, "y")
    .min(-50)
    .max(50)
    .step(0.1)
    .name("Position Y")
    .listen();
  cameraFolder
    .add(camera.position, "z")
    .min(-50)
    .max(50)
    .step(0.1)
    .name("Position Z")
    .listen();

  const fogFolder = gui.addFolder("フォグ");
  const fogParams = { color: scene.fog.color.getHex() };
  fogFolder
    .addColor(fogParams, "color")
    .onChange((v) => scene.fog.color.setHex(v));
  fogFolder.add(scene.fog, "near", 0, 100).step(0.1);
  fogFolder.add(scene.fog, "far", 0, 200).step(0.1);

  const hemiFolder = gui.addFolder("ヘミ");
  const hemiParams = {
    skyColor: hemiLight.color.getHex(),
    groundColor: hemiLight.groundColor.getHex(),
  };
  hemiFolder
    .addColor(hemiParams, "skyColor")
    .onChange((v) => hemiLight.color.setHex(v));
  hemiFolder
    .addColor(hemiParams, "groundColor")
    .onChange((v) => hemiLight.groundColor.setHex(v));
  hemiFolder.add(hemiLight, "intensity", 0, 10).step(0.01);

  const dir1Folder = gui.addFolder("太陽光");
  const dir1Params = { color: dirLight1.color.getHex() };
  dir1Folder
    .addColor(dir1Params, "color")
    .onChange((v) => dirLight1.color.setHex(v));
  dir1Folder.add(dirLight1, "intensity", 0, 10).step(0.01);
  dir1Folder.add(dirLight1.position, "x", -50, 50).step(0.1);
  dir1Folder.add(dirLight1.position, "y", -50, 50).step(0.1);
  dir1Folder.add(dirLight1.position, "z", -50, 50).step(0.1);

  const shadowFolder = dir1Folder.addFolder("Shadow Settings");
  shadowFolder.add(dirLight1.shadow, "bias", -0.01, 0.01).step(0.0001);
  shadowFolder.add(dirLight1.shadow, "normalBias", -0.05, 0.05).step(0.001);
  shadowFolder.add(dirLight1.shadow, "radius", 0, 10).step(0.1);
  shadowFolder
    .add(dirLight1.shadow.camera, "near", 0, 50)
    .step(0.1)
    .onChange(() => dirLight1.shadow.camera.updateProjectionMatrix());
  shadowFolder
    .add(dirLight1.shadow.camera, "far", 0, 200)
    .step(0.1)
    .onChange(() => dirLight1.shadow.camera.updateProjectionMatrix());
  shadowFolder
    .add(dirLight1.shadow.camera, "left", -50, 0)
    .step(0.1)
    .onChange(() => dirLight1.shadow.camera.updateProjectionMatrix());
  shadowFolder
    .add(dirLight1.shadow.camera, "right", 0, 50)
    .step(0.1)
    .onChange(() => dirLight1.shadow.camera.updateProjectionMatrix());
  shadowFolder
    .add(dirLight1.shadow.camera, "top", 0, 50)
    .step(0.1)
    .onChange(() => dirLight1.shadow.camera.updateProjectionMatrix());
  shadowFolder
    .add(dirLight1.shadow.camera, "bottom", -50, 0)
    .step(0.1)
    .onChange(() => dirLight1.shadow.camera.updateProjectionMatrix());

  const dir2Folder = gui.addFolder("補助太陽");
  const dir2Params = { color: dirLight2.color.getHex() };
  dir2Folder
    .addColor(dir2Params, "color")
    .onChange((v) => dirLight2.color.setHex(v));
  dir2Folder.add(dirLight2, "intensity", 0, 10).step(0.01);
  dir2Folder.add(dirLight2.position, "x", -50, 50).step(0.1);
  dir2Folder.add(dirLight2.position, "y", -50, 50).step(0.1);
  dir2Folder.add(dirLight2.position, "z", -50, 50).step(0.1);

  const helperFolder = gui.addFolder("Helpers");
  helperFolder.add(hemiLightHelper, "visible").name("Hemisphere Helper");
  helperFolder.add(dirLight1Helper, "visible").name("DirLight 1 Helper");
  helperFolder
    .add(dirLight1ShadowHelper, "visible")
    .name("Shadow Camera Helper");
  helperFolder.add(dirLight2Helper, "visible").name("DirLight 2 Helper");
}

export function updateWorld() {
  if (controls) controls.update();
  if (hemiLightHelper) hemiLightHelper.update();
  if (dirLight1Helper) dirLight1Helper.update();
  if (dirLight1ShadowHelper) dirLight1ShadowHelper.update();
  if (dirLight2Helper) dirLight2Helper.update();

  if (water) {
    water.material.uniforms["time"].value += 0.08 / 60.0;
  }

  // ★ 雲のアニメーションと「太陽の方向」の同期
  if (cloudMaterial) {
    cloudMaterial.uniforms["time"].value += 1.0 / 60.0;
    // 太陽光(dirLight1)の位置をシェーダーに送り、影の方向をリアルタイム計算させる
    cloudMaterial.uniforms.sunPosition.value
      .copy(dirLight1.position)
      .normalize();
  }

  const delta = clock.getDelta();
  if (mixer) {
    mixer.update(delta);
  }

  // 鳥：ランダムなタイミングで飛来アニメーションを再生
  if (birdAction && !isBirdFlying) {
    birdTimer -= delta;

    if (birdTimer <= 0) {
      birdAction.reset();
      birdAction.play();
      isBirdFlying = true;
    }
  }

  // 葉っぱのランダムな風の強弱計算
  if (windState === "calm") {
    windTimer -= delta;
    windStrength = 0.015; //* 通常時：本当に微妙に（気にならない程度に）動いている状態

    if (windTimer <= 0) {
      windState = "rise";
      //* 突風の最大風速をランダムに決定（0.12 〜 0.18 の間で毎回違う強さの風にする）
      gustMaxStrength = THREE.MathUtils.randFloat(0.12, 0.18);
    }
  } else if (windState === "rise") {
    //* 約0.5秒かけて滑らかに突風のピークへ加速
    windStrength += (delta * (gustMaxStrength - 0.015)) / 0.5;
    if (windStrength >= gustMaxStrength) {
      windStrength = gustMaxStrength;
      windState = "fall";
    }
  } else if (windState === "fall") {
    //* 約2.0秒かけてゆっくりと風が凪いでいく
    windStrength -= (delta * (gustMaxStrength - 0.015)) / 2.0;
    if (windStrength <= 0.015) {
      windStrength = 0.015;
      windState = "calm";
      //* 次の突風が吹くまでのインターバルをランダムに再設定（8〜18秒後）
      windTimer = THREE.MathUtils.randFloat(8.0, 18.0);
    }
  }

  // 葉っぱのカスタムシェーダーへの時間と「変動する風の強さ」の供給
  const elapsedTime = leafClock.getElapsedTime();
  leafMaterials.forEach((uniforms) => {
    uniforms.uTime.value = elapsedTime;
    uniforms.uWindStrength.value = windStrength; // 毎フレーム、現在の風速を注入[cite: 4]
  });
}
