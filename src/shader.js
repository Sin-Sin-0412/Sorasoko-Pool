import * as THREE from "three";

//! 雲
const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float time;
  uniform vec3 skyColorTop;      // 空の上部（深い青）
  uniform vec3 skyColorBottom;   // 空の下部（地平線の明るい青）
  uniform vec3 cloudBaseColor;   // 雲の明るい部分の色
  uniform vec3 cloudShadowColor; // 雲の深い影の色
  uniform vec3 sunPosition;      // 太陽光のベクトル（影の方向に影響）
  
  uniform float cloudScale;
  uniform float cloudSpeed;
  uniform float cloudCutoff;     // 雲の量
  uniform float cloudSmoothness; // 雲のフチのボケ具合（シャープさ）
  
  varying vec2 vUv;

  // 乱数生成
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // 2D 値ノイズ
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  // FBM（フラクタルノイズ）で複雑な雲の形状を作る
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    // 5回重ねてディテールを上げる
    for (int i = 0; i < 8; i++) { 
      v += a * noise(p);
      p = rot * p * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // 1. 空のグラデーション
    vec3 sky = mix(skyColorBottom, skyColorTop, vUv.y);

    // 2. 現在の座標の雲の「密度」を計算
    vec2 uv = vUv * cloudScale + vec2(time * cloudSpeed, 0.0);
    float density = fbm(uv);

    // 3. シャープなちぎれ雲の輪郭を作る
    float cloudAlpha = smoothstep(cloudCutoff, cloudCutoff + cloudSmoothness, density);

    if (cloudAlpha > 0.0) {
        // --- ★ 疑似ボリュームライティング（立体感の要） ---
        
        // 太陽の向きへ少しだけ進んだ場所の密度を測る
        vec2 lightOffset = normalize(sunPosition.xz) * 0.03;
        float densityTowardsSun = fbm(uv + lightOffset);
        
        // 自分より光源側の方が「密度が低い＝光が当たるエッジ」、「密度が高い＝影」
        float shadowDiff = clamp((density - densityTowardsSun) * 20.0, 0.0, 1.0);
        
        // ベース色と影色をブレンド
        vec3 finalCloudColor = mix(cloudShadowColor, cloudBaseColor, shadowDiff);
        
        // 太陽光が直接当たるエッジ部分を抽出し、異常な明るさ（HDR）にする
        float highlight = smoothstep(0.65, 1.0, shadowDiff);
        // Bloom（ポストプロセス）を光らせるため、白（1.0）を超える強い光を足す
        finalCloudColor += vec3(1.2) * highlight; 

        // 空と合成
        sky = mix(sky, finalCloudColor, cloudAlpha);
    }

    // 4. 下部フェード（街並みとのなじませ）
    float edgeFade = smoothstep(0.0, 0.15, vUv.y);
    gl_FragColor = vec4(sky, edgeFade);
  }
`;

export const cloudMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms: {
    time: { value: 0.0 },
    // 写真に近い「少し重い夕方前の色」を初期値に設定
    skyColorTop: { value: new THREE.Color(0x0a0e10) },    
    skyColorBottom: { value: new THREE.Color(0x8aaecc) }, 
    cloudBaseColor: { value: new THREE.Color(0xffffff) }, 
    cloudShadowColor: { value: new THREE.Color(0x5a8196) }, 
    sunPosition: { value: new THREE.Vector3(1, 1, 1) }, 
    cloudScale: { value: 2.11 }, //雲の大きさ
    cloudSpeed: { value: 0.003 }, // 流れる速度
    cloudCutoff: { value: 0.31 },  //雲の少なさ（しきい値）
    cloudSmoothness: { value: 0.061 }, // フチのボケ具合
  },
  transparent: true,
  depthWrite: false,
  side: THREE.BackSide // ドームの内側
});
