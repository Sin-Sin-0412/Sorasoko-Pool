const FADE_DURATION = 1.5;
const AMBIENT_TARGET_VOLUME = 0.8;
const SEMI_TARGET_VOLUME = 1.0;

// ★次のセミが鳴くまでの「待機時間」（ミリ秒）
// ※ 前のセミが "完全に鳴き終わってから" カウントダウンが始まります
const SEMI_WAIT_MIN = 10000;  // 10秒
const SEMI_WAIT_MAX = 300000; // 45秒

// ★セッション最初の1回だけ使う待機時間（5秒〜30秒）
const SEMI_FIRST_WAIT_MIN = 5000;
const SEMI_FIRST_WAIT_MAX = 20000;

let isFirstSemi = true; // ★このセッションでまだ一度もセミが鳴いていないか

let audioCtx = null;
let ambientGainNode = null;
let semiGainNode = null;
let ambientFilterNode = null;

let ambientSourceNode = null;
let currentSemiSource = null; // ★管理するセミは常に1匹だけ！

let ambientBuffer = null;
let semiBuffer = null;

let isLoaded = false;
let isLoading = false;
let isPlaying = false;

let ambientStopTimeoutId = null;
let semiTimeoutId = null;

async function loadBuffers() {
  if (isLoaded || isLoading) return;
  isLoading = true;
  try {
    const [ambientRes, semiRes] = await Promise.all([
      fetch("/audio/pool04.mp3"),
      fetch("/audio/semi.mp3")
    ]);
    const [ambientArray, semiArray] = await Promise.all([
      ambientRes.arrayBuffer(),
      semiRes.arrayBuffer()
    ]);

    // デコードのためにAudioContextを確実に作っておく
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const [decodedAmbient, decodedSemi] = await Promise.all([
      audioCtx.decodeAudioData(ambientArray),
      audioCtx.decodeAudioData(semiArray)
    ]);

    ambientBuffer = decodedAmbient;
    semiBuffer = decodedSemi;
    isLoaded = true;
  } catch (error) {
    console.error("音声読み込みエラー:", error);
  } finally {
    isLoading = false;
  }
}

function ensureContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  if (!ambientGainNode) {
    ambientGainNode = audioCtx.createGain();
    ambientGainNode.gain.value = 0;
    ambientGainNode.connect(audioCtx.destination);
  }

    if (!ambientFilterNode) {
    ambientFilterNode = audioCtx.createBiquadFilter();
    ambientFilterNode.type = "lowpass";          // 高音をカットする設定
    ambientFilterNode.frequency.value = 1000;    // 2500Hz以上を丸める
    ambientFilterNode.connect(ambientGainNode);
  }

  if (!semiGainNode) {
    semiGainNode = audioCtx.createGain();
    semiGainNode.gain.value = SEMI_TARGET_VOLUME;
    semiGainNode.connect(audioCtx.destination);
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function startAmbientSource() {
  if (ambientSourceNode) {
    try { ambientSourceNode.stop(); } catch(e){}
  }
  ambientSourceNode = audioCtx.createBufferSource();
  ambientSourceNode.buffer = ambientBuffer;
  ambientSourceNode.loop = true;
  ambientSourceNode.connect(ambientFilterNode);
  ambientSourceNode.start(0);
}

/**
 * セミが鳴き終わってから呼ばれる「待ち時間」のセット
 */
function scheduleNextSemi() {
  if (!isPlaying) return;

  const minWait = isFirstSemi ? SEMI_FIRST_WAIT_MIN : SEMI_WAIT_MIN;
  const maxWait = isFirstSemi ? SEMI_FIRST_WAIT_MAX : SEMI_WAIT_MAX;
  const waitTime = Math.random() * (maxWait - minWait) + minWait;

  semiTimeoutId = setTimeout(() => {
    isFirstSemi = false; // ★次回からは通常の間隔に切り替え
    playSemi();
  }, waitTime);
}

/**
 * セミを1回だけ鳴らす
 */
function playSemi() {
  if (!isPlaying || !semiBuffer) return;

  currentSemiSource = audioCtx.createBufferSource();
  currentSemiSource.buffer = semiBuffer;
  currentSemiSource.connect(semiGainNode);

  // ★【最重要ポイント】鳴き終わったら、次のスケジュールを入れる
  currentSemiSource.onended = () => {
    currentSemiSource = null;
    scheduleNextSemi(); 
  };

  currentSemiSource.start(0);
}

/**
 * セミの完全停止（長押しで止める時に呼ばれる）
 */
function stopSemi() {
  clearTimeout(semiTimeoutId); // 待機中ならタイマーをキャンセル
  semiTimeoutId = null;

  if (currentSemiSource) {
    // onendedの発火を防ぐため、止めるときはシンプルにstopだけ呼ぶ
    // isPlayingがfalseになるので、もしonendedが走ってもループは回りません
    try { currentSemiSource.stop(); } catch(e){}
    currentSemiSource = null;
  }
}

function fadeAmbientTo(target, duration) {
  const now = audioCtx.currentTime;
  ambientGainNode.gain.cancelScheduledValues(now);
  ambientGainNode.gain.setValueAtTime(ambientGainNode.gain.value, now);
  ambientGainNode.gain.linearRampToValueAtTime(target, now + duration);
}

export async function toggleAmbient() {
  if (isLoading) return; // ロード中の連打ガード
  
  if (!isLoaded) {
    await loadBuffers();
    if (!isLoaded) return;
  }
  
  ensureContext();

  clearTimeout(ambientStopTimeoutId);

  if (!isPlaying) {
    // --- 再生開始 ---
    isPlaying = true;
    startAmbientSource();
    fadeAmbientTo(AMBIENT_TARGET_VOLUME, FADE_DURATION);
    
    // 最初のセミをスケジュール
    scheduleNextSemi();
  } else {
    // --- 停止 ---
    isPlaying = false;
    
    fadeAmbientTo(0, FADE_DURATION);
    stopSemi(); // ★セミは即座にストップ

    const nodeToStop = ambientSourceNode;
    ambientSourceNode = null;
    ambientStopTimeoutId = setTimeout(() => {
      if (nodeToStop) {
        try { nodeToStop.stop(); } catch(e){}
      }
    }, FADE_DURATION * 1000 + 100);
  }
}

export function isAmbientPlaying() {
  return isPlaying;
}