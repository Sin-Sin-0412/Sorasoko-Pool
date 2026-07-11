import gsap from "gsap";

//* min〜maxの範囲でランダムな数値を返す
function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

//* a→bをtの割合(0〜1)で線形補間する
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 太陽光(dirLight)と水面(water)を同期させ、雲の切れ間から光が差すような
 * 明滅をランダムなタイミング・長さ・強さで繰り返す演出を開始する。
 *
 * 仕組み: 毎回のフレアごとに「強さ(0〜1)」を1つだけランダムに決め、
 * その1つの値から intensity と alpha の両方を計算する。
 * tweenは常にこの「強さ」1本だけを動かすので、2つの値が原理的にズレない。
 *
 * @param {THREE.DirectionalLight} dirLight - 明滅させたい太陽光
 * @param {THREE.Water} water - Water.jsのインスタンス（alphaと同期させる）
 * @param {object} [options] - 演出のパラメータ（省略時は下記デフォルト値を使用）
 * @param {number} [options.baseIntensity=0.46] - 平常時の光の強さ
 * @param {number} [options.maxIntensity=5.5] - フレアが最大瞬間に到達しうる光の強さ
 * @param {number} [options.baseAlpha=0.92] - 平常時の水面の不透明度
 * @param {number} [options.minAlpha=0.72] - フレアが最大瞬間に到達しうる水面の不透明度（下限）
 * @param {[number, number]} [options.intervalRange=[5, 20]] - 次のフレアが来るまでの間隔(秒)の範囲
 * @param {[number, number]} [options.durationRange=[1.5, 4.0]] - フレア1回の長さ(秒)の範囲
 * @param {[number, number]} [options.strengthRange=[0.25, 1.0]] - フレアごとの強さの範囲（1.0で最大値まで到達、0.25なら控えめな差し込み）
 * @param {[number, number]} [options.holdRange=[0, 2.5]] - ピークの強さを維持する時間(秒)の範囲（0に近いほどパッと消える短いフレア、大きいほどじっくり光るフレア
 * @returns {{ stop: () => void }} 演出を止めたいときに呼ぶ stop() を含むオブジェクト
 */

export function initSunFlicker(dirLight, water, options = {}) {
  const {
    baseIntensity = 0.76,
    maxIntensity = 5.5,
    baseAlpha = 0.92,
    minAlpha = 0.72,
    intervalRange = [10, 30],
    durationRange = [6.5, 12.0],
    strengthRange = [0.25, 1.0],
    holdRange = [0, 2.5],
  } = options;

  let stopped = false;
  let activeTimeline = null;
  let pendingCall = null;

  //* 「強さ(0〜1)」を受け取って、実際のintensity・alphaに変換して反映する
  function applyStrength(strength) {
    dirLight.intensity = lerp(baseIntensity, maxIntensity, strength);
    water.material.uniforms.alpha.value = lerp(baseAlpha, minAlpha, strength);
  }

  //* 1回分のフレア（立ち上がり→ピーク→減衰）を再生する
  function playFlare() {
    if (stopped) return;
    const duration = randRange(durationRange[0], durationRange[1]);

    //* このフレアがどこまで強くなるか（毎回0.46→5.5フルに振り切るわけではなく、弱い差し込みも作る）
    const peakStrength = randRange(strengthRange[0], strengthRange[1]);

    //* ピークをどれだけ維持するか（0に近ければ今まで通りパッと消え、大きければじっくり光る）
    const holdDuration = randRange(holdRange[0], holdRange[1]);

    const proxy = { strength: 0 };

    activeTimeline = gsap.timeline({
      onUpdate: () => applyStrength(proxy.strength),
      onComplete: () => {
        applyStrength(0);
        activeTimeline = null;
        scheduleNextFlare();
      },
    });

    activeTimeline
      .to(proxy, {
        strength: peakStrength,
        duration: duration * 0.35,
        ease: "sine.in",
      })
      .to(proxy, {
        strength: peakStrength,
        duration: holdDuration,
        ease: "none",
      })
      .to(proxy, {
        strength: 0,
        duration: duration * 0.45,
        ease: "sine.out",
      });
  }

  //* ランダムな間隔をあけて、次のフレアを予約する
  function scheduleNextFlare() {
    if (stopped) return;
    const delay = randRange(intervalRange[0], intervalRange[1]);
    pendingCall = gsap.delayedCall(delay, playFlare);
  }

  scheduleNextFlare();

  return {
    //* 演出を止める（進行中のtweenと予約済みの次回呼び出しの両方をキャンセルし、平常値に戻す）
    stop() {
      stopped = true;
      if (activeTimeline) activeTimeline.kill();
      if (pendingCall) pendingCall.kill();
      applyStrength(0);
    },
  };
}
