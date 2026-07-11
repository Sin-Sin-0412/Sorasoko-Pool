import gsap from "gsap";
import { loadingManager } from "./world.js";

const STORAGE_KEY = "hasVisited";

// ローディング画面のタイミング設定（秒数はすべてgsapのタイムラインが管理する）
const LOGO_APPEAR_DELAY = 400; // 動画開始からロゴのフェードインを始めるまで(ms)
const LOGO_APPEAR_DURATION = 1500; // ロゴのフェードイン所要時間(ms)
const MIN_READY_TIME = 3500; // ここまでは最低でもローディング画面を表示する（基準点、ms）
const FADE_OUT_DURATION = 1500; // ローディング画面全体のフェードアウト時間(ms)

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

// 従来のintro-overlay（WASD案内）の表示/非表示ロジック
// ローディング画面とは独立して、ページ読み込み時に即座に呼ばれる
function setupIntroOverlay() {
  const overlay = document.querySelector("#intro-overlay");
  if (!overlay) return;

  const hasVisited = localStorage.getItem(STORAGE_KEY);

  if (hasVisited) {
    overlay.remove();
    return;
  }

  // タッチデバイスならWASDの案内行を非表示
  if (isTouchDevice()) {
    const wasdLine = overlay.querySelector(".wasd-line");
    if (wasdLine) wasdLine.style.display = "none";
  }

  overlay.addEventListener("click", () => {
    overlay.classList.add("hidden");
    localStorage.setItem(STORAGE_KEY, "true");

    overlay.addEventListener(
      "transitionend",
      () => {
        overlay.remove();
      },
      { once: true },
    );
  });
}

// ローディング画面のセットアップと制御
function setupLoadingScreen() {
  const loadingScreen = document.querySelector("#loading-screen");
  const loadingVideo = document.querySelector("#loading-video");
  const loadingLogo = document.querySelector("#loading-logo");

  if (!loadingScreen) {
    // ローディング画面のDOMが無ければ何もしない
    return;
  }

  let isAssetsReady = false;
  let isMinTimeElapsed = false;
  let hasFinished = false;

  if (loadingVideo) {
    // ブラウザの自動再生ブロック対策として明示的にplay()も呼んでおく
    loadingVideo.play().catch(() => {
    });
  }

  // ロゴのフェードイン
  if (loadingLogo) {
    gsap.to(loadingLogo, {
      opacity: 0.7,
      "--blur-amount": "0px",
      delay: LOGO_APPEAR_DELAY / 1000,
      duration: LOGO_APPEAR_DURATION / 1000,
      ease: "power2.out",
    });

    gsap.to(loadingLogo, {
      opacity: 0,
      delay: 3,
      duration: LOGO_APPEAR_DURATION / 1000,
      ease: "power2.out",
    });
  }

  function tryFinishLoading() {
    if (hasFinished) return;
    if (!isAssetsReady || !isMinTimeElapsed) return;

    hasFinished = true;
    finishLoading();
  }

  function finishLoading() {
    // 3D世界側の演出(main.js)はここに直接依存させず、イベントで疎結合にする
    window.dispatchEvent(new CustomEvent("loading-complete"));

    gsap.to(loadingScreen, {
      opacity: 0,
      duration: FADE_OUT_DURATION / 1000,
      ease: "power1.out",
      onStart: () => {
        loadingScreen.style.pointerEvents = "none";
      },
      onComplete: () => {
        loadingScreen.remove();
      },
    });
  }

  // アセット（モデル・テクスチャ）の読み込み完了を監視
  loadingManager.onLoad = () => {
    isAssetsReady = true;
    tryFinishLoading();
  };

  // 最低表示時間の経過を監視
  window.setTimeout(() => {
    isMinTimeElapsed = true;
    tryFinishLoading();
  }, MIN_READY_TIME);
}

export function initIntro() {
  // この2つは互いに依存しない独立した処理。
  setupIntroOverlay();
  setupLoadingScreen();
}