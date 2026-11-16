/* 千词斩 · 生字复习 */
const STORAGE_KEY = "qiancizhan-hanzi-v1";
const INTERVALS = [1, 2, 4, 7, 15];
const APP_VERSION = "v2026.11.16-2";
const GROUP_SIZE = 8;
const DAILY_NEW_GROUPS = 2;

const TIP_PAY = {
  wechat: "wxp://f2f0u_W1aSxARcyfHse9iwk0iibd-7oBtfKmtkNwrnzJah4",
  alipay: "https://qr.alipay.com/fkx16953low4pxrt2t0wn91",
  wechatImg: "./assets/pay-wechat.png",
  alipayImg: "./assets/pay-alipay.png",
};

const TABS = [
  { id: "home", label: "首页", icon: "home" },
  { id: "study", label: "学习", icon: "book" },
  { id: "train", label: "训练场", icon: "flag" },
  { id: "wrong", label: "错字本", icon: "bookx" },
  { id: "me", label: "我的", icon: "me" },
];

let DATA = null;
let ALL = []; // flattened chars with unit/lesson meta
let state = null;
let tab = "home";
let session = null;
let canvasState = null;

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return todayStr(dt);
}
function greet() {
  const h = new Date().getHours();
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function defaultState() {
  return {
    version: 1,
    selectedUnits: [1, 2, 3, 4, 5, 6, 7],
    onboarded: false,
    profile: {
      streak: 0,
      lastStudyDate: "",
      coins: 0,
      totalCorrect: 0,
      totalWrong: 0,
      mastered: 0,
    },
    history: {},
    cards: {},
    settings: {
      practiceMode: "handwrite", // handwrite | listen
      judgeLevel: "easy", // easy 宽松 | normal 标准 | strict 严格
    },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = Object.assign(defaultState(), JSON.parse(raw));
      state.profile = Object.assign(defaultState().profile, state.profile || {});
      state.settings = Object.assign(defaultState().settings, state.settings || {});
      return;
    }
  } catch (e) {}
  state = defaultState();
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cardOf(ch) {
  if (!state.cards[ch]) {
    state.cards[ch] = {
      status: "new",
      intervalIndex: 0,
      due: null,
      last: null,
      wrongs: 0,
      rights: 0,
      inWrongBook: false,
    };
  }
  return state.cards[ch];
}

function flatten(data) {
  const list = [];
  for (const u of data.units) {
    for (const les of u.lessons) {
      for (const c of les.chars) {
        list.push({
          ...c,
          unitId: u.id,
          unitName: u.name,
          lessonId: les.id,
          lessonTitle: les.title,
          id: c.char,
        });
      }
    }
  }
  return list;
}

function charsInSelected() {
  const set = new Set(state.selectedUnits);
  return ALL.filter((c) => set.has(c.unitId));
}

function isDue(card, today) {
  if (card.status !== "learning") return false;
  return card.due && card.due <= today;
}

function groupsOf(arr) {
  const g = [];
  for (let i = 0; i < arr.length; i += GROUP_SIZE) g.push(arr.slice(i, i + GROUP_SIZE));
  return g;
}

function getTodayPlan() {
  const today = todayStr();
  const selected = charsInSelected();
  // 优先第七单元未测字，再按单元顺序
  const untested = selected.filter((c) => cardOf(c.char).status === "new");
  untested.sort((a, b) => {
    if (a.unitId === 7 && b.unitId !== 7) return -1;
    if (b.unitId === 7 && a.unitId !== 7) return 1;
    return a.unitId - b.unitId || String(a.lessonId).localeCompare(String(b.lessonId));
  });
  const newGroupsAll = groupsOf(untested);
  const newGroups = newGroupsAll.slice(0, DAILY_NEW_GROUPS);
  const due = selected.filter((c) => isDue(cardOf(c.char), today));
  // also include wrong-book items due or never scheduled but marked wrong and learning
  const reviewGroups = groupsOf(due);
  return {
    today,
    untested,
    newGroups,
    newTotalGroups: Math.min(DAILY_NEW_GROUPS, newGroupsAll.length),
    due,
    reviewGroups,
    selected,
  };
}

function todayHistory() {
  const t = todayStr();
  if (!state.history[t]) state.history[t] = { studied: 0, correct: 0, wrong: 0, coins: 0, done: false, newDone: 0, reviewDone: 0 };
  return state.history[t];
}

function applyAnswer(charObj, correct) {
  const card = cardOf(charObj.char);
  const today = todayStr();
  const hist = todayHistory();
  hist.studied += 1;
  card.last = today;
  if (correct) {
    hist.correct += 1;
    card.rights += 1;
    state.profile.totalCorrect += 1;
    state.profile.coins += 5;
    hist.coins += 5;
    if (card.status === "new") card.intervalIndex = 0;
    else card.intervalIndex = Math.min(card.intervalIndex + 1, INTERVALS.length - 1);
    // If they already were at last interval and got it right, mastered
    if (card.status === "learning" && card.intervalIndex === INTERVALS.length - 1 && /* passed 15-day */ true) {
      // Move to next interval first; only master after answering correctly when already at 15-day step
      // We increment first, so we need to detect "was already at last"
    }
    // Better: if previous interval was already last (15) and correct → mastered
    // We'll handle below with a flag
    card.status = "learning";
    card.due = addDays(today, INTERVALS[card.intervalIndex]);
    // If they just completed the 15-day interval (intervalIndex already at last BEFORE increment)
    // Let's redo this more clearly in markCard
  } else {
    hist.wrong += 1;
    card.wrongs += 1;
    card.inWrongBook = true;
    card.status = "learning";
    card.intervalIndex = 0;
    card.due = addDays(today, INTERVALS[0]);
    state.profile.totalWrong += 1;
  }
  saveState();
}

function markCard(charObj, correct) {
  const card = cardOf(charObj.char);
  const today = todayStr();
  const hist = todayHistory();
  hist.studied += 1;
  card.last = today;

  if (correct) {
    hist.correct += 1;
    card.rights += 1;
    state.profile.totalCorrect += 1;
    state.profile.coins += 5;
    hist.coins += 5;
    if (card.status === "mastered") {
      // stay mastered
    } else if (card.status === "learning" && card.intervalIndex === INTERVALS.length - 1) {
      // already on 15-day step and got it right → 已掌握
      card.status = "mastered";
      card.due = null;
      card.inWrongBook = false;
      state.profile.mastered = (state.profile.mastered || 0) + 1;
      state.profile.coins += 15;
      hist.coins += 15;
    } else {
      if (card.status === "new") card.intervalIndex = 0;
      else card.intervalIndex = Math.min(card.intervalIndex + 1, INTERVALS.length - 1);
      card.status = "learning";
      card.due = addDays(today, INTERVALS[card.intervalIndex]);
      if (card.wrongs === 0 || card.rights >= card.wrongs + 2) {
        // keep in wrong book until a later success streak? remove after a correct in review
        // only remove if it was a review of wrong book and correct
      }
    }
  } else {
    hist.wrong += 1;
    card.wrongs += 1;
    card.inWrongBook = true;
    card.status = "learning";
    card.intervalIndex = 0;
    card.due = addDays(today, INTERVALS[0]);
    state.profile.totalWrong += 1;
  }
  saveState();
}

function maybeCompleteDaily(plan) {
  const hist = todayHistory();
  if (hist.done) return false;
  const newLeft = plan.newGroups.filter(groupStillOpen).length;
  const reviewLeft = plan.reviewGroups.filter(groupStillOpen).length;
  // After answering, recompute? Caller should pass fresh plan
  if (newLeft === 0 && reviewLeft === 0 && (plan.newGroups.length + plan.reviewGroups.length > 0 || hist.studied > 0)) {
    if (plan.newGroups.length + plan.reviewGroups.length === 0 && hist.studied === 0) return false;
  }
  const fresh = getTodayPlan();
  const nLeft = fresh.newGroups.filter(groupStillOpen).length;
  const rLeft = fresh.reviewGroups.filter(groupStillOpen).length;
  const hadWork = fresh.newTotalGroups > 0 || fresh.reviewGroups.length > 0 || hist.studied > 0;
  if (nLeft === 0 && rLeft === 0 && hadWork && hist.studied > 0) {
    hist.done = true;
    state.profile.coins += 20;
    hist.coins += 20;
    updateStreak();
    saveState();
    return true;
  }
  return false;
}

function groupStillOpen(g) {
  const today = todayStr();
  return g.some((c) => {
    const card = cardOf(c.char);
    if (card.status === "new") return true;
    if (card.status === "learning" && card.due && card.due <= today && card.last !== today) return true;
    return false;
  });
}

function updateStreak() {
  const today = todayStr();
  const last = state.profile.lastStudyDate;
  if (last === today) return;
  const yest = addDays(today, -1);
  if (last === yest) state.profile.streak += 1;
  else state.profile.streak = 1;
  state.profile.lastStudyDate = today;
}

let speechUnlocked = false;
let speakToken = 0;

function unlockSpeech() {
  if (speechUnlocked) return;
  try {
    if (window.speechSynthesis.getVoices) window.speechSynthesis.getVoices();
    const u = new SpeechSynthesisUtterance(" ");
    u.lang = "zh-CN";
    u.volume = 0.01;
    u.rate = 2;
    window.speechSynthesis.speak(u);
    speechUnlocked = true;
  } catch (e) {}
}

function setupSpeechUnlock() {
  const unlock = () => {
    unlockSpeech();
    document.removeEventListener("touchstart", unlock, true);
    document.removeEventListener("click", unlock, true);
  };
  document.addEventListener("touchstart", unlock, true);
  document.addEventListener("click", unlock, true);
}

function speak(text) {
  try {
    unlockSpeech();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.85;
    u.pitch = 1.05;
    window.speechSynthesis.cancel();
    speakToken += 1;
    highlightWord(-1);
    window.speechSynthesis.speak(u);
    return u;
  } catch (e) {
    pulseSpeakers();
    return null;
  }
}

function highlightWord(index) {
  document.querySelectorAll(".word-pill").forEach((el, i) => {
    el.classList.toggle("playing", index === i);
  });
}

function highlightCharSpeak(on) {
  document.querySelector(".pinyin-speak")?.classList.toggle("playing", !!on);
}

function pulseSpeakers() {
  document.querySelector(".pinyin-row")?.classList.add("need-tap");
  document.querySelector(".pinyin-speak")?.classList.add("need-tap");
  document.querySelector(".words-row")?.classList.add("need-tap");
}

function charSpeakText(item) {
  if (!item) return "";
  const ch = item.char;
  const word = (item.words || []).find((w) => w.includes(ch)) || (item.words || [])[0];
  if (item.pinyinAlt && word) return `${ch}，${word}的${ch}`;
  return ch;
}

function shouldSpeakCharFirst(item) {
  if (!item || !session) return false;
  // 训练场纯听写在揭晓前不读生字，以免直接报出答案
  if (session.mode === "dictation" && !session.revealed && !session.hwResult) return false;
  return true;
}

function speakSequence(parts) {
  if (!parts || !parts.length) return;
  speakToken += 1;
  const my = speakToken;
  try { window.speechSynthesis.cancel(); } catch (e) {}
  highlightWord(-1);
  highlightCharSpeak(false);
  if (!speechUnlocked) {
    pulseSpeakers();
    return;
  }
  let i = 0;
  const playNext = () => {
    if (my !== speakToken) return;
    if (i >= parts.length) {
      highlightWord(-1);
      highlightCharSpeak(false);
      return;
    }
    const part = parts[i];
    highlightCharSpeak(part.type === "char");
    highlightWord(part.type === "word" ? part.index : -1);
    try {
      const u = new SpeechSynthesisUtterance(part.text);
      u.lang = "zh-CN";
      u.rate = 0.85;
      u.pitch = 1.05;
      u.onend = () => {
        i += 1;
        setTimeout(playNext, 280);
      };
      u.onerror = () => {
        pulseSpeakers();
        highlightWord(-1);
        highlightCharSpeak(false);
      };
      window.speechSynthesis.speak(u);
      setTimeout(() => {
        if (my !== speakToken) return;
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
        if (i === 0) pulseSpeakers();
      }, 700);
    } catch (e) {
      pulseSpeakers();
    }
  };
  playNext();
}

function speakWordsSequentially(words) {
  const item = currentItem && currentItem();
  if (item) {
    playItemIntro(item, { force: true, wordsOnly: true });
    return;
  }
  speakSequence((words || []).map((text, index) => ({ type: "word", text, index })));
}

function playItemIntro(item, opts = {}) {
  if (!item) return;
  const force = !!opts.force;
  const wordsOnly = !!opts.wordsOnly;
  const charOnly = !!opts.charOnly;
  if (!force && session && session.introPlayedIndex === session.index) return;
  if (session && !force && !charOnly && !wordsOnly) session.introPlayedIndex = session.index;
  const parts = [];
  if (!wordsOnly && shouldSpeakCharFirst(item)) {
    parts.push({ type: "char", text: charSpeakText(item) });
  }
  if (!charOnly) {
    (item.words || []).forEach((text, index) => parts.push({ type: "word", text, index }));
  }
  speakSequence(parts);
}

function speakerIcon() {
  return `<span class="spk-ico" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4.5 9.2h3.3L12 5.4v13.2l-4.2-3.8H4.5z" fill="currentColor"/>
      <path class="wave w1" d="M15 9.6a3.1 3.1 0 0 1 0 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path class="wave w2" d="M17.6 7.5a6 6 0 0 1 0 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  </span>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function maskWordHtml(word, ch) {
  return Array.from(word)
    .map((c) => (c === ch ? `<i class="blank" aria-hidden="true"></i>` : escapeHtml(c)))
    .join("");
}

function practiceMode() {
  return (state?.settings?.practiceMode === "listen") ? "listen" : "handwrite";
}

function setPracticeMode(mode) {
  if (!state.settings) state.settings = { practiceMode: mode };
  state.settings.practiceMode = mode;
  saveState();
}

function pageTop(title, extra = "") {
  return `<div class="topbar">
    <div class="top-left">
      <button class="icon-btn" data-tab="home" aria-label="返回首页">‹</button>
      <div class="brand">${title}</div>
    </div>
    ${extra}
  </div>`;
}

function modeToggleHtml() {
  const mode = practiceMode();
  return `<div class="seg" role="tablist" aria-label="练习方式">
    <button class="seg-btn ${mode === "handwrite" ? "on" : ""}" data-act="set-mode" data-mode="handwrite">手写版</button>
    <button class="seg-btn ${mode === "listen" ? "on" : ""}" data-act="set-mode" data-mode="listen">听写版</button>
  </div>`;
}

function icon(name, active) {
  const c = active ? "#1d6fe8" : "#94a3b8";
  const icons = {
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10.5V19h11v-8.5"/></svg>`,
    book: `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"><path d="M5 5.5A3.5 3.5 0 0 1 8.5 4H19v14H8.5A3.5 3.5 0 0 0 5 21.5Z"/><path d="M5 5.5v16"/></svg>`,
    flag: `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v16"/><path d="M6 5h11l-2.2 3.8L17 13H6"/></svg>`,
    bookx: `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"><path d="M6 5h10.5A2.5 2.5 0 0 1 19 7.5V19H8"/><path d="M6 5v14a2 2 0 0 0 2 2h11"/><path d="m10 10 4 4m0-4-4 4"/></svg>`,
    me: `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19c1.2-3 3.5-4.5 6.5-4.5s5.3 1.5 6.5 4.5"/></svg>`,
  };
  return icons[name];
}

function pandaSVG() {
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="100" cy="176" rx="48" ry="10" fill="rgba(30,80,160,0.12)"/>
    <ellipse cx="100" cy="128" rx="58" ry="50" fill="#f7f8fb" stroke="#1a1a1a" stroke-width="3"/>
    <ellipse cx="100" cy="128" rx="58" ry="50" fill="#fff"/>
    <path d="M70 150c10 16 50 16 60 0" fill="none" stroke="#1a1a1a" stroke-width="3"/>
    <!-- arms -->
    <ellipse cx="48" cy="128" rx="16" ry="22" fill="#1a1a1a" transform="rotate(-18 48 128)"/>
    <ellipse cx="152" cy="122" rx="16" ry="22" fill="#1a1a1a" transform="rotate(28 152 122)"/>
    <!-- pencil -->
    <g transform="translate(150 78) rotate(28)">
      <rect x="0" y="0" width="10" height="58" rx="2" fill="#f5c451"/>
      <rect x="0" y="0" width="10" height="10" fill="#ff6b6b"/>
      <polygon points="0,58 10,58 5,70" fill="#e8c9a0"/>
      <polygon points="3.5,66 6.5,66 5,70" fill="#333"/>
    </g>
    <!-- feet -->
    <ellipse cx="74" cy="168" rx="16" ry="10" fill="#1a1a1a"/>
    <ellipse cx="126" cy="168" rx="16" ry="10" fill="#1a1a1a"/>
    <!-- scarf -->
    <path d="M70 118c10 22 50 22 62-2" fill="none" stroke="#ef4444" stroke-width="10" stroke-linecap="round"/>
    <path d="M124 122l14 26c2 4-2 6-6 4l-12-18" fill="#ef4444"/>
    <!-- head -->
    <circle cx="100" cy="78" r="46" fill="#fff" stroke="#1a1a1a" stroke-width="3"/>
    <ellipse cx="62" cy="48" rx="18" ry="16" fill="#1a1a1a" transform="rotate(-28 62 48)"/>
    <ellipse cx="138" cy="48" rx="18" ry="16" fill="#1a1a1a" transform="rotate(28 138 48)"/>
    <ellipse cx="82" cy="80" rx="13" ry="15" fill="#1a1a1a"/>
    <ellipse cx="118" cy="80" rx="13" ry="15" fill="#1a1a1a"/>
    <circle cx="86" cy="76" r="4.2" fill="#fff"/>
    <circle cx="122" cy="76" r="4.2" fill="#fff"/>
    <ellipse cx="100" cy="94" rx="8" ry="5.5" fill="#1a1a1a"/>
    <path d="M96 100c3 5 11 5 14 0" fill="none" stroke="#1a1a1a" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="70" cy="96" r="6" fill="#ffb3c1" opacity="0.9"/>
    <circle cx="130" cy="96" r="6" fill="#ffb3c1" opacity="0.9"/>
  </svg>`;
}

function tabbarHTML() {
  const plan = getTodayPlan();
  const wrongN = ALL.filter((c) => cardOf(c.char).inWrongBook && cardOf(c.char).status !== "mastered").length;
  const dueN = plan.due.length + plan.untested.slice(0, DAILY_NEW_GROUPS * GROUP_SIZE).length;
  return `<nav class="tabbar" id="tabbar">
    ${TABS.map((t) => {
      const active = tab === t.id;
      let badge = "";
      if (t.id === "wrong" && wrongN) badge = `<span class="badge">${wrongN > 99 ? "99+" : wrongN}</span>`;
      if (t.id === "home" && dueN && !todayHistory().done) badge = `<span class="badge">${dueN > 99 ? "99+" : dueN}</span>`;
      return `<button class="tab ${active ? "active" : ""}" data-tab="${t.id}">${icon(t.icon, active)}${badge}<span>${t.label}</span></button>`;
    }).join("")}
  </nav>`;
}

function showToast(msg) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.getElementById("app").appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

/* ---------------- views ---------------- */
function render() {
  const view = document.getElementById("view");
  const app = document.getElementById("app");
  const immersive = !!(session && session.active);
  view.className = immersive ? "immersive page-enter" : "page-enter";
  if (immersive) {
    view.innerHTML = renderSession();
    document.getElementById("tabbar")?.remove();
    view.scrollTop = 0;
    bindSession();
    return;
  }
  if (!document.getElementById("tabbar")) {
    app.insertAdjacentHTML("beforeend", tabbarHTML());
  } else {
    document.getElementById("tabbar").outerHTML = tabbarHTML();
    document.getElementById("tabbar").hidden = false;
  }
  document.getElementById("tabbar").hidden = false;
  if (tab === "home") view.innerHTML = renderHome();
  else if (tab === "study") view.innerHTML = renderStudy();
  else if (tab === "train") view.innerHTML = renderTrain();
  else if (tab === "wrong") view.innerHTML = renderWrong();
  else view.innerHTML = renderMe();
  bindGlobal();
}

function renderHome() {
  const plan = getTodayPlan();
  const hist = todayHistory();
  const newDone = plan.newGroups.filter((g) => !groupStillOpen(g)).length;
  const revDone = plan.reviewGroups.filter((g) => !groupStillOpen(g)).length;
  const newTotal = plan.newTotalGroups;
  const revTotal = plan.reviewGroups.length;
  const total = newTotal * GROUP_SIZE + plan.due.length;
  const doneCount = Math.min(hist.studied, total) || hist.correct + hist.wrong;
  // progress among today's assigned
  const assigned = plan.newGroups.flat().length + plan.due.length;
  const remainNew = plan.newGroups.filter(groupStillOpen).flat().length;
  const remainRev = plan.reviewGroups.filter(groupStillOpen).flat().length;
  const remain = remainNew + remainRev;
  const finished = assigned === 0 ? hist.studied : Math.max(0, assigned - remain);
  const pct = assigned ? Math.round((finished / assigned) * 100) : hist.done ? 100 : 0;
  const unit7left = ALL.filter((c) => c.unitId === 7 && cardOf(c.char).status === "new").length;

  return `
    <div class="topbar">
      <div class="brand"><span class="logo-mark">字</span>千词斩</div>
      <div class="pills">
        <span class="pill"><span class="ico">🔥</span>${state.profile.streak} 天</span>
        <span class="pill"><span class="ico">⭐</span>${state.profile.coins}</span>
      </div>
    </div>
    <div class="mascot-wrap">${pandaSVG()}</div>
    <div class="hello">
      <h1>${greet()}，开始复习吧！</h1>
      <p>间隔记忆 · 今天记得更牢一点点</p>
    </div>
    ${
      unit7left
        ? `<button class="hint-banner" data-act="placement-unit" data-unit="7">
            <span class="txt">第七单元还有 ${unit7left} 个字没摸底，建议优先复习</span>
            <span class="go">去摸底 ›</span>
          </button>`
        : ""
    }
    <div class="card today-card">
      <span class="tag">今日复习</span>
      <h2>${hist.done ? "今日任务已完成，太棒了！" : remain ? `还有 ${remain} 个字等你来复习` : assigned ? "今日任务已完成，太棒了！" : "先选单元做一次摸底吧"}</h2>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="progress-meta"><span>已完成 ${finished}/${assigned || finished}</span><span>${pct}%</span></div>
    </div>
    <div class="cta-row">
      <button class="cta cta-new" data-act="start-new" ${newTotal === 0 ? "disabled" : ""}>
        新学
        <span class="sub">${newDone}/${newTotal || 0} 组</span>
      </button>
      <button class="cta cta-review" data-act="start-review" ${revTotal === 0 ? "disabled" : ""}>
        复习
        <span class="sub">${revDone}/${revTotal || 0} 组</span>
      </button>
    </div>
    <button class="cta cta-full ghost" data-tab="study">去学习页选择单元 / 摸底</button>
  `;
}

function renderStudy() {
  const selected = new Set(state.selectedUnits);
  const units = DATA.units
    .map((u) => {
      const chars = u.lessons.flatMap((l) => l.chars);
      const known = chars.filter((c) => ["learning", "mastered"].includes(cardOf(c.char).status)).length;
      const wrong = chars.filter((c) => cardOf(c.char).inWrongBook && cardOf(c.char).status !== "mastered").length;
      const mastered = chars.filter((c) => cardOf(c.char).status === "mastered").length;
      const open = u._open ? "open" : "";
      const pri = u.id === 7 ? "priority" : "";
      return `<div class="card unit-card ${open}" data-unit-card="${u.id}">
        <div class="unit-head ${pri}">
          <button class="ck ${selected.has(u.id) ? "on" : ""}" data-act="toggle-unit" data-unit="${u.id}">${selected.has(u.id) ? "✓" : ""}</button>
          <button class="meta" data-act="toggle-open" data-unit="${u.id}">
            <b>第${u.id}单元 · ${u.name}${u.id === 7 ? "  · 建议优先" : ""}</b>
            <span>${chars.length} 个会写字 · 已测 ${known} · 掌握 ${mastered}${wrong ? " · 错字 " + wrong : ""}</span>
          </button>
        </div>
        <div class="unit-lessons">
          ${u.lessons
            .map(
              (l) => `<div class="lesson-row">
              <div>
                <div>${l.id} ${l.title}</div>
                <div class="char-chips">
                  ${l.chars
                    .map((c) => {
                      const card = cardOf(c.char);
                      let cls = "chip";
                      if (card.status === "mastered") cls += " mastered";
                      else if (card.inWrongBook) cls += " wrong";
                      else if (card.status === "learning") cls += " known";
                      return `<span class="${cls}">${c.char}</span>`;
                    })
                    .join("")}
                </div>
              </div>
            </div>`
            )
            .join("")}
          <button class="mini-btn" style="margin-top:8px" data-act="placement-unit" data-unit="${u.id}">摸底本单元</button>
        </div>
      </div>`;
    })
    .join("");

  return `
    ${pageTop("学习计划", `<span class="data-badge">${DATA.meta.dataLabel}</span>`)}
    <div class="card soft">
      <b>${DATA.meta.title}</b>
      <p class="h-sub" style="margin-top:6px">${DATA.meta.shortTitle} · 写字表 ${DATA.meta.totalWrite} 字 · 共 8 个单元</p>
    </div>
    <p class="section-title">勾选要复习的单元，再开始摸底</p>
    ${units}
    <button class="cta cta-full green" data-act="placement-selected">摸底已选单元（每次 8 个字）</button>
    <div class="bottom-spacer"></div>
  `;
}

function renderTrain() {
  const items = [
    { id: "dictation", ico: "听", bg: "linear-gradient(135deg,#60a5fa,#2563eb)", title: "听写", desc: "听词语，在田字格里写出汉字" },
    { id: "pinyin", ico: "拼", bg: "linear-gradient(135deg,#38bdf8,#0284c7)", title: "看拼音写字", desc: "看拼音和组词，回忆字形再默写" },
    { id: "words", ico: "词", bg: "linear-gradient(135deg,#34d399,#059669)", title: "组词选择", desc: "给生字选出正确的组词" },
    { id: "similar", ico: "辨", bg: "linear-gradient(135deg,#fbbf24,#f59e0b)", title: "形近字辨析", desc: "把容易写混的字区分开来" },
    { id: "wrong", ico: "错", bg: "linear-gradient(135deg,#fb7185,#e11d48)", title: "错字巩固", desc: "专练错字本里还没掌握的字" },
  ];
  return `
    ${pageTop("训练场")}
    <div class="hello" style="margin-top:4px"><h1 style="font-size:18px">选一种方式来练</h1>
    <p>先想再看答案，记得更牢</p></div>
    <div class="grid-2" style="margin-top:8px">
      ${items
        .map(
          (it) => `<button class="train-card" data-act="train" data-mode="${it.id}">
          <span class="train-ico" style="background:${it.bg}">${it.ico}</span>
          <b>${it.title}</b>
          <span>${it.desc}</span>
        </button>`
        )
        .join("")}
    </div>
  `;
}

function renderWrong() {
  const list = ALL.filter((c) => cardOf(c.char).inWrongBook && cardOf(c.char).status !== "mastered");
  if (!list.length) {
    return `${pageTop("错字本")}<div class="empty"><div class="emo">🌟</div><h3>错字本是空的</h3><p>摸底或复习时点「不会」的字会出现在这里</p></div>`;
  }
  return `
    ${pageTop("错字本", `<span class="pill">共 ${list.length} 字</span>`)}
    <div class="card">
      ${list
        .map((c) => {
          const card = cardOf(c.char);
          return `<div class="wrong-item">
            <div class="han">${c.char}</div>
            <div class="info">
              <b>${c.pinyin} · 第${c.unitId}单元 ${c.lessonTitle}</b>
              <p>${c.words.join("　")}</p>
            </div>
            <button class="mini-btn" data-act="practice-one" data-char="${c.char}">练习</button>
          </div>`;
        })
        .join("")}
    </div>
    <button class="cta cta-full" data-act="train" data-mode="wrong">开始巩固错字</button>
  `;
}

function renderMe() {
  const mastered = ALL.filter((c) => cardOf(c.char).status === "mastered").length;
  const learning = ALL.filter((c) => cardOf(c.char).status === "learning").length;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    const h = state.history[d] || { studied: 0 };
    days.push({ d, n: h.studied, label: d.slice(5) });
  }
  const max = Math.max(1, ...days.map((x) => x.n));
  return `
    ${pageTop("我的")}
    <div class="stat-row">
      <div class="stat-box"><div class="n">${state.profile.streak}</div><div class="l">连续打卡</div></div>
      <div class="stat-box"><div class="n">${state.profile.coins}</div><div class="l">小星星</div></div>
      <div class="stat-box"><div class="n">${mastered}</div><div class="l">已掌握</div></div>
    </div>
    <div class="card">
      <h3 class="section-title" style="margin-top:0">近 7 天学习量</h3>
      <div class="chart">
        ${days
          .map(
            (x) => `<div class="col">
            <div class="bar" style="height:${Math.max(6, (x.n / max) * 90)}px;opacity:${x.n ? 1 : 0.35}"></div>
            <div class="d">${x.label}</div>
          </div>`
          )
          .join("")}
      </div>
      <p class="h-sub" style="margin-top:8px">学习中 ${learning} 字 · 累计答对 ${state.profile.totalCorrect} 次</p>
    </div>
    <div class="card settings-card">
      <h3 class="section-title" style="margin-top:0">练习方式</h3>
      ${modeToggleHtml().replace('class="seg"', 'class="seg wide"')}
      <p class="h-sub">手写版：在田字格里写出这个字，写完提交，系统会判断字形和笔顺。听写版：看拼音和组词，在本子上写，再点「会了 / 不会」。</p>
    </div>
    <div class="card settings-card">
      <h3 class="section-title" style="margin-top:0">书写判定</h3>
      <div class="seg wide" role="tablist" aria-label="判定松紧">
        <button class="seg-btn ${judgeLevel() === "easy" ? "on" : ""}" data-act="set-judge" data-level="easy">宽松</button>
        <button class="seg-btn ${judgeLevel() === "normal" ? "on" : ""}" data-act="set-judge" data-level="normal">标准</button>
        <button class="seg-btn ${judgeLevel() === "strict" ? "on" : ""}" data-act="set-judge" data-level="strict">严格</button>
      </div>
      <p class="h-sub">三档都会检查笔顺，只是字形和位置的宽容程度不同。宽松更适合孩子（默认）。字写对但笔顺不对时会单独提示。</p>
    </div>
    <button class="tip-entry" type="button" data-act="show-tip">
      <span class="tip-ico">🍱</span>
      <span class="tip-txt"><strong>请开发者吃便当</strong><small>如果觉得还不错，请随意打赏</small></span>
      <span class="chev">›</span>
    </button>
    <div class="note">
      <strong>数据说明（${DATA.meta.dataLabel}）</strong><br/>
      ${DATA.meta.sourceNote}<br/>
      来源：${DATA.meta.source}<br/>
      本册按统编版（2024 修订）编排，共 8 个单元。进度保存在本机，不需要登录。
    </div>
    <button class="cta cta-full ghost" style="margin-top:14px" data-act="reset">清空学习进度</button>
    <p class="app-ver">${APP_VERSION}</p>
    <div class="bottom-spacer"></div>
  `;
}

/* ---------------- session ---------------- */
function startSession(mode, list, title) {
  if (!list || !list.length) {
    showToast("暂时没有要练的字");
    return;
  }
  session = {
    active: true,
    mode,
    title,
    queue: list.slice(),
    index: 0,
    revealed: false,
    correct: 0,
    wrong: 0,
    answers: [],
  };
  session.hwResult = null;
  session.introPlayedIndex = -1;
  resetInkState();
  destroyWriter();
  unlockSpeech();
  if (mode === "words" || mode === "similar") prepareChoices(session.queue[0]);
  render();
}

function currentItem() {
  return session?.queue[session.index];
}

function renderSession() {
  if (session.done) return renderResult();
  const item = currentItem();
  const i = session.index + 1;
  const n = session.queue.length;
  const pct = (session.index / n) * 100;
  const mode = session.mode;

  let body = "";
  if (mode === "words") body = renderWordsQuiz(item);
  else if (mode === "similar") body = renderSimilarQuiz(item);
  else body = renderWriteQuiz(item, mode);

  const showModeToggle = mode !== "words" && mode !== "similar";
  return `
    <div class="quiz-top">
      <button class="icon-btn" data-act="quit" aria-label="返回">‹</button>
      <div class="bar"><div class="progress"><i style="width:${pct}%"></i></div></div>
      <span class="pill">${i}/${n}</span>
    </div>
    ${showModeToggle ? `<div class="quiz-head">${modeToggleHtml()}</div>` : ""}
    <div class="quiz-stage">${body}</div>
  `;
}

function renderWordPills(item, revealed) {
  return `<div class="words-row">${item.words
    .map((w) => {
      const label = revealed ? escapeHtml(w) : maskWordHtml(w, item.char);
      return `<button class="word-pill" data-act="speak" data-text="${escapeHtml(w)}" aria-label="朗读 ${escapeHtml(w)}">${speakerIcon()}<span class="wtxt">${label}</span></button>`;
    })
    .join("")}</div>`;
}

function renderWriteQuiz(item, mode) {
  const listenJudge = practiceMode() === "listen";
  const audioOnly = mode === "dictation";
  const judged = !!session.hwResult;
  const revealed = session.revealed || judged;
  // 听写版：拼音 + 遮罩组词始终出示，孩子在纸上写
  const showPinyin = listenJudge ? true : (!audioOnly || revealed);
  const wordsVisible = listenJudge ? true : !(audioOnly && !revealed);

  let padInner = "";
  if (!listenJudge) {
    const r0 = session.hwResult;
    const showSolid = r0 && (r0.passed || (r0.writingOk && r0.orderOk !== false && (r0.hints || 0) && !r0.hintsExhausted));
    padInner = `<div class="grid"></div>
      ${session.hwResult ? `<div class="ghost-char" style="opacity:${showSolid ? 1 : 0.16};transform:none">${item.char}</div>` : ""}
      <div id="hw-target"></div>
      ${session.hwResult ? "" : `<canvas id="hw-hint"></canvas><canvas id="hw-ink"></canvas>`}`;
  } else if (revealed) {
    padInner = `<div class="grid"></div>
      <div class="ghost-char" style="opacity:1;transform:none">${item.char}</div>`;
  }

  let footer = "";
  if (!listenJudge) {
    if (session.hwResult) {
      const passed = !!session.hwResult.passed;
      const writingOk = !!session.hwResult.writingOk;
      const orderOk = session.hwResult.orderOk !== false;
      const hints = session.hwResult.hints || 0;
      const orderErr = session.hwResult.orderError;
      let bannerCls = "retry", emo = "💪", msg = "再试试，先看一遍笔顺吧";
      let extraHint = "";
      if (passed) {
        bannerCls = "ok"; emo = "🎉"; msg = "正确，写得真好！";
      } else if (writingOk && !orderOk) {
        bannerCls = "order"; emo = "✍️"; msg = "字写对了，但笔顺不对哦";
        if (orderErr && orderErr.message) extraHint = `<div class="order-hint">${orderErr.message}</div>`;
      } else if (writingOk && hints) {
        bannerCls = "soft"; emo = "✨"; msg = "看过提示后写对了，明天再练一次";
      } else if (session.hwResult.hintsExhausted) {
        bannerCls = "retry"; emo = "👀"; msg = "提示看完了，跟我一起记笔顺吧";
      }
      const similar = item.similar && item.similar.length ? `<div class="similar-hint">别和这些字搞混：${item.similar.join("　")}</div>` : "";
      const orderWrong = writingOk && !orderOk;
      footer = `
        <div class="feedback-banner ${bannerCls}">
          <span class="emo">${emo}</span>
          <span>${msg}</span>
        </div>
        ${extraHint}
        ${similar}
        ${
          passed
            ? `<div class="actions one"><button class="cta cta-full green" data-act="next">下一题</button></div>
               ${overrideBtnHtml(false, "判错了，其实我不会")}`
            : writingOk && hints && orderOk
            ? `<div class="actions one"><button class="cta cta-full green" data-act="next">下一题</button></div>
               ${overrideBtnHtml(true, "其实我已经会了")}`
            : `<div class="actions">
                <button class="cta green" data-act="retry-hw">再写一次</button>
                <button class="cta orange" data-act="mark" data-ok="0">我还是不会</button>
              </div>
              ${overrideBtnHtml(true, orderWrong ? "其实笔顺也对了" : "其实我写对了")}`
        }`;
    } else {
      footer = `
        <p class="hw-tip">在田字格里写出这个字，写完点提交</p>
        <div class="tool-row">
          <button class="tool-btn hint" data-act="hint-hw">${toolIcon("hint")}<span>提示</span><span class="hint-count"></span></button>
          <button class="tool-btn" data-act="clear-pad">${toolIcon("rewrite")}<span>重写</span></button>
          <button class="tool-btn" data-act="speak-words">${toolIcon("listen")}<span>再听一遍</span></button>
        </div>
        <div class="actions one hw-submit-wrap"><button class="cta cta-full" data-act="submit-hw">提交</button></div>`;
    }
  } else if (revealed) {
    footer = `
        ${item.similar && item.similar.length ? `<div class="similar-hint">别和这些字搞混：${item.similar.join("　")}</div>` : ""}
        <div class="actions">
          <button class="cta green" data-act="mark" data-ok="1">会了 😊</button>
          <button class="cta orange" data-act="mark" data-ok="0">不会 😅</button>
        </div>`;
  } else {
    footer = `
        <div class="tool-row">
          <button class="tool-btn" data-act="speak-words">${toolIcon("listen")}<span>再听一遍</span></button>
        </div>
        <div class="actions one"><button class="cta cta-full" data-act="reveal">我想好了，看答案</button></div>`;
  }

  let padBlock = "";
  if (!listenJudge) {
    padBlock = `<div class="tianzige hw-mode ${judged ? "judged" : ""}" id="pad">${padInner}</div>`;
  } else if (revealed) {
    padBlock = `<div class="tianzige revealed" id="pad">${padInner}</div>`;
  } else {
    padBlock = paperCardHtml();
  }

  return `
    <p class="h-sub">${session.title} · 第${item.unitId}单元 ${item.lessonTitle}</p>
    ${showPinyin ? `<div class="pinyin-row"><div class="pinyin-xl">${item.pinyin}${item.pinyinAlt ? " / " + item.pinyinAlt : ""}</div><button class="pinyin-speak" data-act="speak-char" aria-label="朗读生字">${speakerIcon()}</button></div>` : `<div class="pinyin-xl" style="opacity:.3">?</div>`}
    ${wordsVisible ? renderWordPills(item, revealed) : `<p class="h-sub">听完后写下这个字</p>`}
    ${padBlock}
    ${footer}
  `;
}

function renderWordsQuiz(item) {
  const opts = session.choices || [];
  return `
    <p class="h-sub">${session.title}</p>
    <div class="char-xl">${item.char}</div>
    <div class="pinyin-xl" style="font-size:22px">${item.pinyin}</div>
    <p class="h-sub">哪一个是这个字的组词？</p>
    <div class="choices">
      ${opts
        .map(
          (o, idx) =>
            `<button class="choice ${o.cls || ""}" data-act="choose" data-i="${idx}" ${session.revealed ? "disabled" : ""}>${o.text}</button>`
        )
        .join("")}
    </div>
    ${
      session.revealed
        ? `<div class="actions">
            <button class="cta green" data-act="next">下一题</button>
          </div>`
        : ""
    }
  `;
}

function renderSimilarQuiz(item) {
  const opts = session.choices || [];
  const prompt = session.prompt || "";
  return `
    <p class="h-sub">${session.title}</p>
    <div class="pinyin-xl" style="font-size:28px;margin-top:12px">${prompt}</div>
    <p class="h-sub">请选出正确的字</p>
    <div class="choices choice-chars">
      ${opts
        .map(
          (o, idx) =>
            `<button class="choice ${o.cls || ""}" data-act="choose" data-i="${idx}" ${session.revealed ? "disabled" : ""}>${o.text}</button>`
        )
        .join("")}
    </div>
    ${session.revealed ? `<p class="h-sub" style="margin-top:12px">${item.char}（${item.pinyin}）${item.words.join("、")}</p><div class="actions"><button class="cta green" data-act="next">下一题</button></div>` : ""}
  `;
}

function renderResult() {
  const { correct, wrong, queue } = session;
  return `
    <div class="result-screen">
      <div class="big">${wrong === 0 ? "🎉" : "💪"}</div>
      <h1 class="h-title">${wrong === 0 ? "全部会了，真棒！" : "这一组练完啦"}</h1>
      <p class="h-sub" style="margin:8px 0 16px">会了 ${correct} 个 · 不会 ${wrong} 个 · 共 ${queue.length} 个</p>
      <div class="card" style="text-align:left">
        <p>不会的字已放入错字本，会按 1-2-4-7-15 天再见面。</p>
        <p class="h-sub" style="margin-top:6px">答对会进入下一间隔，答错就从第 1 天重新计时。</p>
      </div>
      <button class="cta cta-full green" data-act="finish">回到首页</button>
      ${session.moreLeft ? `<button class="cta cta-full ghost" data-act="more-group" style="margin-top:12px">再练一组（还剩 ${session.moreLeft} 个）</button>` : ""}
    </div>
  `;
}

function prepareChoices(item) {
  if (session.mode === "words") {
    const correct = item.words[0];
    const pool = ALL.filter((c) => c.char !== item.char)
      .flatMap((c) => c.words)
      .filter((w) => w !== correct && !item.words.includes(w));
    const distract = shuffle(pool).slice(0, 3);
    session.choices = shuffle([{ text: correct, ok: true }, ...distract.map((t) => ({ text: t, ok: false }))]);
  } else if (session.mode === "similar") {
    const word = item.words[0] || item.char;
    const other = (item.similar && item.similar[0]) || pickSimilarFallback(item.char);
    session.prompt = `「${word}」里的字是？`;
    session.choices = shuffle([
      { text: item.char, ok: true },
      { text: other, ok: false },
    ]);
  }
}

function pickSimilarFallback(ch) {
  const pool = ALL.map((c) => c.char).filter((c) => c !== ch);
  return pool[Math.floor(Math.random() * pool.length)];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextQuestion() {
  session.index += 1;
  session.revealed = false;
  session.choices = null;
  session.hwResult = null;
  destroyWriter();
  resetInkState();
  if (session.index >= session.queue.length) {
    session.done = true;
    const plan = getTodayPlan();
    const completed = maybeCompleteDaily(plan);
    session.dailyComplete = completed;
    if (session.mode === "pinyin" || session.mode === "dictation") {
      const left = charsInSelected().filter((c) => cardOf(c.char).status === "new");
      session.moreLeft = left.length;
      session.moreKind = "new";
    } else {
      session.moreLeft = 0;
    }
    render();
    if (completed) celebrate();
    maybeShowTipPrompt();
    return;
  }
  const item = currentItem();
  if (session.mode === "words" || session.mode === "similar") prepareChoices(item);
  render();
}

function celebrate() {
  const layer = document.createElement("div");
  layer.className = "confetti";
  const colors = ["#3b82f6", "#f59e0b", "#22c55e", "#fb7185", "#a78bfa"];
  for (let i = 0; i < 28; i++) {
    const s = document.createElement("i");
    s.style.left = Math.random() * 100 + "%";
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = Math.random() * 0.4 + "s";
    s.style.animationDuration = 1.2 + Math.random() * 0.8 + "s";
    layer.appendChild(s);
  }
  document.getElementById("app").appendChild(layer);
  setTimeout(() => layer.remove(), 2200);
}

function overrideIcon(kind) {
  if (kind === "yes") {
    return `<svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  }
  return `<svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`;
}

function overrideBtnHtml(ok, label) {
  return `<div class="override-row"><button class="override-btn" data-act="override" data-ok="${ok ? "1" : "0"}">${overrideIcon(ok ? "yes" : "no")}<span>${label}</span></button></div>`;
}

function paperCardHtml() {
  return `<div class="paper-card">
    <svg class="paper-illu" viewBox="0 0 160 120" fill="none" aria-hidden="true">
      <rect x="26" y="12" width="90" height="98" rx="10" fill="#fff" stroke="#93c5fd" stroke-width="2.5"/>
      <path d="M26 28h90" stroke="#bfdbfe" stroke-width="2"/>
      <rect x="26" y="12" width="90" height="16" rx="10" fill="#dbeafe"/>
      <path d="M40 44h62M40 60h62M40 76h48" stroke="#bfdbfe" stroke-width="3" stroke-linecap="round"/>
      <g transform="translate(104 26) rotate(26)">
        <rect x="0" y="8" width="13" height="62" rx="3" fill="#3b82f6"/>
        <rect x="0" y="0" width="13" height="14" rx="3" fill="#fbbf24"/>
        <path d="M0 70h13L6.5 88z" fill="#f59e0b"/>
        <path d="M5 82l1.5 6L8 82z" fill="#1e293b"/>
      </g>
    </svg>
    <p class="paper-msg">请在本子上写下这个字</p>
  </div>`;
}

function toolIcon(name) {
  if (name === "hint") {
    return `<svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-3.9 12.8V17h7.8v-2.2A7 7 0 0 0 12 2z"/></svg>`;
  }
  if (name === "rewrite") {
    return `<svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`;
  }
  if (name === "listen") {
    return `<svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9.5a3.2 3.2 0 0 1 0 5"/><path d="M18.2 7.2a6 6 0 0 1 0 9.6"/></svg>`;
  }
  return "";
}

/* ---------------- handwriting (free write + judge) ---------------- */
let STROKES = {};
let hwWriter = null;
let inkStrokes = [];      // array of [{x,y} in CSS px of ink canvas]
let currentInk = null;
let hintedCount = 0;
let hintBusy = false;
let inkSize = 0;
let inkPadding = 8;
let inkCtx = null;
let hintCtx = null;
let inkBound = false;

function hasStrokeData(ch) {
  return !!(STROKES && STROKES[ch]);
}

function destroyWriter() {
  if (hwWriter) {
    try { hwWriter.cancelQuiz(); } catch (e) {}
    try { hwWriter.hideCharacter(); } catch (e) {}
  }
  hwWriter = null;
}

function resetInkState() {
  inkStrokes = [];
  currentInk = null;
  hintedCount = 0;
  hintBusy = false;
  inkCtx = null;
  hintCtx = null;
}

function charToLocal(cx, cy, width, height, padding) {
  const fromX = 0, fromY = -124, preW = 1024, preH = 1024;
  const effectiveWidth = width - 2 * padding;
  const effectiveHeight = height - 2 * padding;
  const scale = Math.min(effectiveWidth / preW, effectiveHeight / preH);
  const xCenteringBuffer = padding + (effectiveWidth - scale * preW) / 2;
  const yCenteringBuffer = padding + (effectiveHeight - scale * preH) / 2;
  const xOffset = -fromX * scale + xCenteringBuffer;
  const yOffset = -fromY * scale + yCenteringBuffer;
  return { x: cx * scale + xOffset, y: height - (cy * scale + yOffset) };
}

function localToChar(x, y, width, height, padding) {
  const fromX = 0, fromY = -124, preW = 1024, preH = 1024;
  const effectiveWidth = width - 2 * padding;
  const effectiveHeight = height - 2 * padding;
  const scale = Math.min(effectiveWidth / preW, effectiveHeight / preH) || 1;
  const xCenteringBuffer = padding + (effectiveWidth - scale * preW) / 2;
  const yCenteringBuffer = padding + (effectiveHeight - scale * preH) / 2;
  const xOffset = -fromX * scale + xCenteringBuffer;
  const yOffset = -fromY * scale + yCenteringBuffer;
  return { x: (x - xOffset) / scale, y: (height - y - yOffset) / scale };
}

function setupCanvasContext(cvs, cssW, cssH) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  cvs.width = Math.max(1, Math.floor(cssW * dpr));
  cvs.height = Math.max(1, Math.floor(cssH * dpr));
  cvs.style.width = cssW + "px";
  cvs.style.height = cssH + "px";
  const ctx = cvs.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return ctx;
}

function setupHandwrite() {
  destroyWriter();
  const item = currentItem();
  const target = document.getElementById("hw-target");
  const ink = document.getElementById("hw-ink");
  const hint = document.getElementById("hw-hint");
  if (!item || !target || !ink) return;
  if (typeof HanziWriter === "undefined" || !hasStrokeData(item.char)) {
    showToast("这个字暂无笔顺数据，已切换到听写版");
    setPracticeMode("listen");
    session.hwResult = null;
    render();
    return;
  }
  const size = Math.floor(target.getBoundingClientRect().width || ink.getBoundingClientRect().width || 220);
  inkSize = size;
  inkPadding = 8;
  hintCtx = hint ? setupCanvasContext(hint, size, size) : null;
  inkCtx = setupCanvasContext(ink, size, size);
  bindInkEvents(ink);
  redrawHintCanvas();
  redrawInkCanvas();
  updateHintLabel();

  hwWriter = HanziWriter.create(target, item.char, {
    width: size,
    height: size,
    padding: inkPadding,
    showCharacter: false,
    showOutline: false,
    strokeColor: "#3b82f6",
    drawingColor: "#1d4ed8",
    strokeWidth: 6,
    highlightColor: "#60a5fa",
    outlineColor: "#dbeafe",
    strokeAnimationSpeed: 1.15,
    delayBetweenStrokes: 160,
    charDataLoader: (char, onComplete) => {
      const data = STROKES[char];
      if (data) onComplete(data);
    },
  });
  setTimeout(persistHintedStrokes, 0);
  window.__hanziDebug = {
    char: item.char,
    size,
    padding: inkPadding,
    data: STROKES[item.char],
    writer: hwWriter,
    toLocal: (cx, cy) => charToLocal(cx, cy, size, size, inkPadding),
    inkStrokes,
    hintedCount,
  };
}

function bindInkEvents(cvs) {
  if (cvs.dataset.bound === "1") return;
  cvs.dataset.bound = "1";
  const pos = (e) => {
    const r = cvs.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const start = (e) => {
    e.preventDefault();
    const p = pos(e);
    currentInk = [p];
    if (!inkCtx) return;
    inkCtx.strokeStyle = "#1e3a6e";
    inkCtx.lineWidth = 6;
    inkCtx.beginPath();
    inkCtx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!currentInk) return;
    e.preventDefault();
    const p = pos(e);
    const last = currentInk[currentInk.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.6) return;
    currentInk.push(p);
    inkCtx.lineTo(p.x, p.y);
    inkCtx.stroke();
    inkCtx.beginPath();
    inkCtx.moveTo(p.x, p.y);
  };
  const end = (e) => {
    if (!currentInk) return;
    if (e) e.preventDefault();
    if (currentInk.length >= 2) inkStrokes.push(currentInk);
    currentInk = null;
  };
  cvs.addEventListener("pointerdown", start);
  cvs.addEventListener("pointermove", move);
  cvs.addEventListener("pointerup", end);
  cvs.addEventListener("pointercancel", end);
  cvs.addEventListener("pointerleave", (e) => { if (currentInk) end(e); });
  cvs.addEventListener("touchstart", start, { passive: false });
  cvs.addEventListener("touchmove", move, { passive: false });
  cvs.addEventListener("touchend", end);
}

function redrawInkCanvas() {
  if (!inkCtx || !inkSize) return;
  inkCtx.clearRect(0, 0, inkSize, inkSize);
  inkCtx.strokeStyle = "#1e3a6e";
  inkCtx.lineWidth = 6;
  for (const stroke of inkStrokes) {
    if (!stroke || stroke.length < 2) continue;
    inkCtx.beginPath();
    inkCtx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) inkCtx.lineTo(stroke[i].x, stroke[i].y);
    inkCtx.stroke();
  }
}

function persistHintedStrokes() {
  const rs = hwWriter && hwWriter._renderState;
  const ch = hwWriter && hwWriter._character;
  if (!rs || !ch) return;
  const strokes = {};
  for (let i = 0; i < ch.strokes.length; i++) {
    const on = i < hintedCount;
    strokes[i] = { opacity: on ? 1 : 0, displayPortion: on ? 1 : 0 };
  }
  rs.updateState({ character: { main: { opacity: 1, strokes } } });
}

function redrawHintCanvas() {
  // hints are drawn by hanzi-writer; keep the overlay canvas clear
  if (hintCtx && inkSize) hintCtx.clearRect(0, 0, inkSize, inkSize);
}

function updateHintLabel() {
  const el = document.querySelector(".hint-count");
  const item = currentItem();
  const total = (item && STROKES[item.char] && STROKES[item.char].medians || []).length;
  if (el) el.textContent = hintedCount && total ? ` ${hintedCount}/${total}` : "";
}

async function revealNextHint() {
  const item = currentItem();
  const medians = item && STROKES[item.char] && STROKES[item.char].medians;
  if (!medians || hintBusy) return;
  if (hintedCount >= medians.length) return;
  hintBusy = true;
  const btn = document.querySelector('[data-act="hint-hw"]');
  if (btn) btn.disabled = true;
  const index = hintedCount;
  try {
    if (hwWriter) await hwWriter.animateStroke(index);
  } catch (e) {}
  hintedCount += 1;
  persistHintedStrokes();
  updateHintLabel();
  hintBusy = false;
  if (btn) btn.disabled = false;
  if (hintedCount >= medians.length) {
    finishHandwrite({ writingOk: false, hints: hintedCount, hintsExhausted: true });
  }
}

function clearInkOnly() {
  inkStrokes = [];
  currentInk = null;
  redrawInkCanvas();
}

function submitHandwrite() {
  const usable = inkStrokes.filter((s) => s && s.length >= 2);
  if (!usable.length) {
    showToast("先在田字格里写一写再提交");
    return;
  }
  const item = currentItem();
  const verdict = judgeHandwriting(usable, item && item.char, inkSize, inkPadding);
  finishHandwrite({
    writingOk: !!(verdict.shapeOk || verdict.ok),
    orderOk: !!verdict.orderOk,
    orderError: verdict.orderError || null,
    hints: hintedCount,
    hintsExhausted: false,
    detail: verdict,
  });
}

function finishHandwrite({ writingOk, orderOk = true, orderError = null, hints, hintsExhausted, detail }) {
  if (!session || session.hwResult) return;
  const item = currentItem();
  const passed = !!(writingOk && orderOk && !hints && !hintsExhausted);
  const already = (session.answers || []).some((a) => a.char === item.char);
  session.hwResult = { passed, writingOk, orderOk: !!orderOk, orderError, hints: hints || 0, hintsExhausted: !!hintsExhausted, detail, recorded: already };
  session.revealed = true;
  if (!already) recordHwResult(passed);
  render();
  if (passed) celebrateLight();
}

/* ---- geometric stroke matcher (hanzi-writer style, lenient for kids) ---- */
function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

function pointDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function resample(pts, n = 24) {
  if (!pts || pts.length < 2) return (pts || []).slice();
  const L = polylineLength(pts);
  if (L === 0) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));
  const step = L / (n - 1);
  const out = [pts[0]];
  let acc = 0, i = 0;
  for (let k = 1; k < n - 1; k++) {
    const target = step * k;
    while (i < pts.length - 1) {
      const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (acc + seg >= target) break;
      acc += seg;
      i++;
    }
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) || 1;
    const t = (target - acc) / seg;
    out.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function centroid(pts) {
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

function normalizeCurve(pts) {
  const c = centroid(pts);
  const t = pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  const rmse = Math.sqrt(t.reduce((s, p) => s + p.x * p.x + p.y * p.y, 0) / t.length) || 1;
  return t.map((p) => ({ x: p.x / rmse, y: p.y / rmse }));
}

function frechet(a, b) {
  const n = a.length, m = b.length;
  const dist = (i, j) => Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y);
  const dp = Array.from({ length: n }, () => Array(m).fill(Infinity));
  dp[0][0] = dist(0, 0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (i === 0 && j === 0) continue;
      const prev = Math.min(i ? dp[i - 1][j] : Infinity, j ? dp[i][j - 1] : Infinity, i && j ? dp[i - 1][j - 1] : Infinity);
      dp[i][j] = Math.max(prev, dist(i, j));
    }
  }
  return dp[n - 1][m - 1];
}

function avgPointToPolyline(points, line) {
  if (!points.length || line.length < 2) return Infinity;
  let s = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      best = Math.min(best, distToSegment(p, line[i - 1], line[i]));
    }
    s += best;
  }
  return s / points.length;
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return pointDist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function cosine(a, b) {
  const n = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (!n) return 1;
  return (a.x * b.x + a.y * b.y) / n;
}

function judgeLevel() {
  const lv = state?.settings?.judgeLevel;
  return lv === "normal" || lv === "strict" ? lv : "easy";
}

function judgeParams(level) {
  const lv = level || judgeLevel();
  if (lv === "strict") {
    return { leniency: 1.12, startEnd: 260, avg: 230, shape: 0.58, lenMin: 0.32, mergeDist: 220, mergePenalty: 0.22, splitPenalty: 0.2, passAvg: 0.72, cover: 0.82 };
  }
  if (lv === "normal") {
    return { leniency: 1.4, startEnd: 340, avg: 300, shape: 0.78, lenMin: 0.28, mergeDist: 280, mergePenalty: 0.16, splitPenalty: 0.16, passAvg: 0.85, cover: 0.75 };
  }
  return { leniency: 1.75, startEnd: 450, avg: 400, shape: 1.0, lenMin: 0.24, mergeDist: 340, mergePenalty: 0.12, splitPenalty: 0.12, passAvg: 1.05, cover: 0.68 };
}

function bboxOf(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1, w: 1, h: 1 };
  return { minX, minY, maxX, maxY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function normalizeToRef(userStrokes, refStrokes) {
  const ub = bboxOf(userStrokes), rb = bboxOf(refStrokes);
  const scale = Math.max(rb.w, rb.h) / Math.max(ub.w, ub.h, 1);
  const uCx = (ub.minX + ub.maxX) / 2, uCy = (ub.minY + ub.maxY) / 2;
  const rCx = (rb.minX + rb.maxX) / 2, rCy = (rb.minY + rb.maxY) / 2;
  return userStrokes.map((s) => s.map((p) => ({
    x: (p.x - uCx) * scale + rCx,
    y: (p.y - uCy) * scale + rCy,
  })));
}

function rotateStrokes(strokes, deg, cx, cy) {
  if (!deg) return strokes;
  const rad = deg * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return strokes.map((st) => st.map((p) => {
    const dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  }));
}

function concatPolys(a, b) {
  if (!a || !a.length) return (b || []).slice();
  if (!b || !b.length) return a.slice();
  return a.concat(b);
}

function endpointsClose(a, b, dist) {
  if (!a || !b || !a.length || !b.length) return false;
  return pointDist(a[a.length - 1], b[0]) <= dist
    || pointDist(a[a.length - 1], b[b.length - 1]) <= dist
    || pointDist(a[0], b[0]) <= dist;
}

function strokeName(pts) {
  if (!pts || pts.length < 2) return "这一笔";
  const L = polylineLength(pts);
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy);
    if (len > 10) segs.push({ dx, dy, len, ang: Math.atan2(dy, dx) });
  }
  let turns = 0;
  for (let i = 1; i < segs.length; i++) {
    let d = segs[i].ang - segs[i - 1].ang;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > Math.PI * 0.38) turns++;
  }
  const dx = pts[pts.length - 1].x - pts[0].x;
  const dy = pts[pts.length - 1].y - pts[0].y;
  const vdx = dx, vdy = -dy;
  if (turns >= 1) {
    const a0 = segs[0] || { dx: vdx, dy: -vdy };
    const visDx = a0.dx, visDy = -a0.dy;
    if (Math.abs(visDx) >= Math.abs(visDy) && visDx > 0) return "横折";
    if (Math.abs(visDy) > Math.abs(visDx) && visDy > 0) return "竖折";
    return "折";
  }
  if (L < 90) return "点";
  const absx = Math.abs(vdx), absy = Math.abs(vdy);
  if (absx > absy * 1.55) {
    if (vdx > 0 && vdy < -absx * 0.28) return "提";
    return "横";
  }
  if (absy > absx * 1.55) return "竖";
  if (vdx < 0 && vdy > 0) return "撇";
  if (vdx > 0 && vdy > 0) return L > 180 ? "捺" : "点";
  if (vdx > 0 && vdy < 0) return "提";
  return "撇";
}

function evaluateStroke(userPts, stdPts, P) {
  const run = (pts) => {
    if (!pts || pts.length < 2 || !stdPts || stdPts.length < 2) {
      return { ok: false, cost: 9 };
    }
    const start = pointDist(pts[0], stdPts[0]);
    const end = pointDist(pts[pts.length - 1], stdPts[stdPts.length - 1]);
    const startEnd = start <= P.startEnd * P.leniency && end <= P.startEnd * P.leniency;
    const dirU = { x: pts[pts.length - 1].x - pts[0].x, y: pts[pts.length - 1].y - pts[0].y };
    const dirS = { x: stdPts[stdPts.length - 1].x - stdPts[0].x, y: stdPts[stdPts.length - 1].y - stdPts[0].y };
    const dirC = cosine(dirU, dirS);
    const dirOk = dirC > -0.25;
    const avg = avgPointToPolyline(resample(pts, 20), stdPts);
    const distOk = avg <= P.avg * P.leniency;
    const shape = frechet(normalizeCurve(resample(pts, 20)), normalizeCurve(resample(stdPts, 20)));
    const shapeOk = shape <= P.shape * P.leniency;
    const uLen = polylineLength(pts), sLen = polylineLength(stdPts);
    const ratio = (uLen + 30) / (sLen + 30);
    const lenOk = P.leniency * ratio >= P.lenMin && ratio <= 3.4 * P.leniency;
    const ok = startEnd && dirOk && distOk && shapeOk && lenOk;
    const cost = (start + end) / (P.startEnd * 2.2) + avg / (P.avg * 1.4) + shape / (P.shape * 1.15) + (dirOk ? (1 - dirC) * 0.15 : 0.7) + (lenOk ? 0 : 0.45);
    return { ok, cost, start, end, avg, shape, dirC };
  };
  const fwd = run(userPts);
  const bak = run([...userPts].reverse());
  bak.backwards = true;
  if (bak.cost < fwd.cost) return { ...bak, cost: bak.cost + 0.08, ok: bak.ok };
  return fwd;
}

function minAssignment(cost) {
  const n = cost.length;
  const m = n ? cost[0].length : 0;
  const dim = Math.max(n, m, 1);
  const BIG = 1e5;
  const a = Array.from({ length: dim }, (_, i) =>
    Array.from({ length: dim }, (_, j) => (i < n && j < m ? cost[i][j] : BIG))
  );
  const u = Array(dim + 1).fill(0);
  const v = Array(dim + 1).fill(0);
  const p = Array(dim + 1).fill(0);
  const way = Array(dim + 1).fill(0);
  for (let i = 1; i <= dim; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(dim + 1).fill(Infinity);
    const used = Array(dim + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= dim; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= dim; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const userToRef = Array(n).fill(-1);
  let total = 0, matched = 0;
  for (let j = 1; j <= dim; j++) {
    if (p[j] && p[j] <= n && j <= m) {
      userToRef[p[j] - 1] = j - 1;
      total += cost[p[j] - 1][j - 1];
      matched++;
    }
  }
  return { userToRef, total, matched };
}

function inOrderMatch(users, std, P) {
  const n = users.length, m = std.length;
  const INF = 1e9;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(INF));
  const bt = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  dp[0][0] = 0;
  const ev1 = (i, j) => evaluateStroke(users[i], std[j], P);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (dp[i][j] >= INF) continue;
      if (i < n && j < m) {
        const ev = ev1(i, j);
        const add = ev.ok ? ev.cost : ev.cost + 0.85;
        if (ev.ok || ev.cost < 2.2) {
          const v = dp[i][j] + add;
          if (v < dp[i + 1][j + 1]) {
            dp[i + 1][j + 1] = v;
            bt[i + 1][j + 1] = { i, j, kind: ev.ok ? "match" : "weak", ev, j2: j };
          }
        }
      }
      if (i < n && j + 1 < m && endpointsClose(std[j], std[j + 1], P.mergeDist)) {
        const ev = evaluateStroke(users[i], concatPolys(std[j], std[j + 1]), P);
        const add = (ev.ok ? ev.cost : ev.cost + 0.85) + P.mergePenalty;
        if (ev.ok || ev.cost < 2.3) {
          const v = dp[i][j] + add;
          if (v < dp[i + 1][j + 2]) {
            dp[i + 1][j + 2] = v;
            bt[i + 1][j + 2] = { i, j, kind: ev.ok ? "merge" : "merge-weak", ev, j2: j + 1 };
          }
        }
      }
      if (i + 1 < n && j < m && endpointsClose(users[i], users[i + 1], P.mergeDist)) {
        const ev = evaluateStroke(concatPolys(users[i], users[i + 1]), std[j], P);
        const add = (ev.ok ? ev.cost : ev.cost + 0.85) + P.splitPenalty;
        if (ev.ok || ev.cost < 2.3) {
          const v = dp[i][j] + add;
          if (v < dp[i + 2][j + 1]) {
            dp[i + 2][j + 1] = v;
            bt[i + 2][j + 1] = { i, j, kind: ev.ok ? "split" : "split-weak", ev, j2: j };
          }
        }
      }
    }
  }
  const steps = [];
  let ci = n, cj = m;
  let good = 0, weak = 0, covered = 0;
  while (ci > 0 || cj > 0) {
    const step = bt[ci][cj];
    if (!step) break;
    steps.push(step);
    const isWeak = String(step.kind).includes("weak");
    if (isWeak) weak++;
    else good++;
    covered += (step.j2 - step.j + 1);
    ci = step.i;
    cj = step.j;
  }
  steps.reverse();
  const avgCost = n && m && dp[n][m] < INF ? dp[n][m] / Math.max(good + weak, 1) : 9;
  const countTol = Math.max(1, Math.round(m * 0.25));
  const countOk = Math.abs(n - m) <= countTol;
  const coverOk = covered / m >= P.cover;
  const qualityOk = avgCost <= P.passAvg * P.leniency && good >= Math.ceil(m * 0.55);
  const ok = dp[n][m] < INF && countOk && coverOk && qualityOk && weak <= Math.max(1, Math.floor(m * 0.25));
  return { ok, cost: dp[n][m], avgCost, good, weak, covered, countOk, steps };
}

function shapeAssignment(users, std, P) {
  const n = users.length, m = std.length;
  if (!n || !m) return { ok: false, userToRef: [], avg: 9 };
  const cost = Array.from({ length: n }, (_, i) =>
    Array.from({ length: m }, (__, j) => evaluateStroke(users[i], std[j], P).cost)
  );
  const asg = minAssignment(cost);
  const usedRef = new Set();
  let sum = 0, good = 0, paired = 0;
  const userToRef = asg.userToRef.slice();
  for (let i = 0; i < n; i++) {
    const j = userToRef[i];
    if (j < 0 || usedRef.has(j)) continue;
    usedRef.add(j);
    const ev = evaluateStroke(users[i], std[j], P);
    sum += ev.cost;
    paired++;
    if (ev.ok || ev.cost < P.passAvg * P.leniency * 1.15) good++;
  }
  const avg = paired ? sum / paired : 9;
  const countTol = Math.max(1, Math.round(m * 0.25));
  const ok = Math.abs(n - m) <= countTol && good / m >= P.cover && avg <= P.passAvg * P.leniency * 1.1 && paired >= m - countTol;
  return { ok, userToRef, avg, good, paired };
}

function orderVerdict(users, std, P, inOrderResult, shapeResult) {
  const map = shapeResult.userToRef || [];
  let inversion = false;
  let last = -1;
  for (let i = 0; i < map.length; i++) {
    if (map[i] < 0) continue;
    if (map[i] < last) inversion = true;
    last = map[i];
  }
  if (!inversion) {
    return { orderOk: !!inOrderResult.ok, orderError: null };
  }
  let evidence = 0;
  if (users.length === std.length) {
    let idCost = 0, asg = 0;
    for (let i = 0; i < users.length; i++) {
      idCost += evaluateStroke(users[i], std[i], P).cost;
      const r = map[i] >= 0 ? map[i] : i;
      asg += evaluateStroke(users[i], std[r], P).cost;
      if (map[i] >= 0 && map[i] !== i) {
        const forced = evaluateStroke(users[i], std[i], P);
        const pref = evaluateStroke(users[i], std[map[i]], P);
        if (pref.cost + 0.2 < forced.cost) evidence++;
      }
    }
    if (asg + 0.12 * users.length < idCost) evidence += 2;
  } else {
    for (let i = 0; i < map.length; i++) {
      const r = map[i];
      if (r < 0 || i >= std.length || r === i) continue;
      const forced = evaluateStroke(users[i], std[Math.min(i, std.length - 1)], P);
      const pref = evaluateStroke(users[i], std[r], P);
      if (pref.cost + 0.2 < forced.cost) evidence++;
    }
  }
  if (evidence >= 1) {
    return { orderOk: false, orderError: firstOrderError(users, std, map) };
  }
  return { orderOk: !!inOrderResult.ok, orderError: null };
}

function firstOrderError(users, std, userToRef) {
  let expected = 0;
  const seen = new Set();
  for (let i = 0; i < userToRef.length; i++) {
    const r = userToRef[i];
    if (r < 0) continue;
    if (r !== expected) {
      const name = strokeName(std[expected] || std[0]);
      return {
        strokeNum: expected,
        name,
        message: `第${expected + 1}笔应该先写「${name}」`,
      };
    }
    seen.add(r);
    expected++;
    while (seen.has(expected)) expected++;
  }
  return { strokeNum: expected, name: strokeName(std[expected] || std[0]), message: `第${expected + 1}笔应该先写「${strokeName(std[expected] || std[0])}」` };
}

function judgeFromCharStrokes(ch, rawStrokes, level) {
  const data = STROKES[ch];
  if (!data || !data.medians || !data.medians.length) return { ok: false, shapeOk: false, orderOk: false, reason: "no-data" };
  const std = data.medians.map((m) => m.map(([x, y]) => ({ x, y })));
  const raw = (rawStrokes || []).filter((s) => s && s.length >= 2);
  const lens = raw.map(polylineLength);
  let users0 = raw.filter((s, i) => lens[i] >= 36);
  if (users0.length < Math.max(1, Math.ceil(std.length * 0.45))) {
    users0 = raw.filter((s, i) => lens[i] >= 16);
  }
  if (!users0.length) return { ok: false, shapeOk: false, orderOk: false, reason: "empty", n: 0, m: std.length };
  const P = judgeParams(level);
  const rb = bboxOf(std);
  const cx = (rb.minX + rb.maxX) / 2, cy = (rb.minY + rb.maxY) / 2;
  const ub0 = bboxOf(users0);
  const ucx = (ub0.minX + ub0.maxX) / 2, ucy = (ub0.minY + ub0.maxY) / 2;
  const angles = (level === "strict") ? [0, -5, 5] : [0, -8, 8, -14, 14];
  let bestOrder = null, bestShape = null, bestUsers = null, bestAsg = null;
  for (const ang of angles) {
    const rotated = rotateStrokes(users0, ang, ucx, ucy);
    const users = normalizeToRef(rotated, std);
    const ordered = inOrderMatch(users, std, P);
    const shape = shapeAssignment(users, std, P);
    if (!bestOrder || ordered.cost < bestOrder.cost) {
      bestOrder = ordered;
      bestUsers = users;
    }
    if (!bestShape || shape.avg < bestShape.avg) {
      bestShape = shape;
      bestAsg = shape;
    }
  }
  let orderOk = !!bestOrder.ok;
  let orderError = null;
  if (bestAsg && bestAsg.userToRef) {
    const ov = orderVerdict(bestUsers, std, P, bestOrder, bestAsg);
    orderOk = ov.orderOk;
    orderError = ov.orderError;
  } else if (!orderOk && bestAsg && bestAsg.ok && bestAsg.userToRef) {
    orderError = firstOrderError(bestUsers, std, bestAsg.userToRef);
  }
  const shapeOk = orderOk || !!bestShape.ok;
  if (shapeOk && !orderOk && !orderError && bestAsg && bestAsg.userToRef) {
    orderError = firstOrderError(bestUsers, std, bestAsg.userToRef);
  }
  return {
    ok: orderOk && shapeOk,
    shapeOk,
    orderOk,
    orderError,
    n: users0.length,
    m: std.length,
    ordered: { cost: bestOrder.cost, avgCost: bestOrder.avgCost, good: bestOrder.good, weak: bestOrder.weak },
    shape: { avg: bestShape && bestShape.avg, good: bestShape && bestShape.good },
    level: level || judgeLevel(),
  };
}

function judgeHandwriting(localStrokes, ch, size, padding, level) {
  const data = STROKES[ch];
  if (!data || !data.medians || !data.medians.length) {
    return { ok: false, shapeOk: false, orderOk: false, reason: "no-data" };
  }
  const raw = (localStrokes || [])
    .map((s) => s.map((p) => localToChar(p.x, p.y, size, size, padding)))
    .filter((s) => s.length >= 2);
  return judgeFromCharStrokes(ch, raw, level);
}


window.__judgeRaw = judgeFromCharStrokes;
window.__judgeInk = (ch, level) => judgeHandwriting(inkStrokes, ch || (currentItem() && currentItem().char), inkSize, inkPadding, level);

async function simulateCorrectStrokes() {
  const item = currentItem();
  const data = item && STROKES[item.char];
  if (!data || !inkSize) return false;
  inkStrokes = data.medians.map((median) =>
    interpolatePts(median.map(([cx, cy]) => charToLocal(cx, cy, inkSize, inkSize, inkPadding)), 10)
  );
  redrawInkCanvas();
  return true;
}

function interpolatePts(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i]);
    if (i === pts.length - 1) break;
    const a = pts[i], b = pts[i + 1];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.floor(dist / step));
    for (let k = 1; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  return out;
}

async function simulateWrongStrokes() {
  if (!inkSize) return false;
  const s = inkSize;
  inkStrokes = [
    interpolatePts([{ x: 28, y: 28 }, { x: s - 28, y: s - 28 }], 8),
    interpolatePts([{ x: s - 28, y: 28 }, { x: 28, y: s - 28 }], 8),
    interpolatePts([{ x: 36, y: s / 2 }, { x: s - 36, y: s / 2 }], 8),
  ];
  redrawInkCanvas();
  return true;
}

window.__simulateCorrectWrite = simulateCorrectStrokes;
window.__simulateWrongWrite = simulateWrongStrokes;
window.__submitHw = () => submitHandwrite();
window.__hintHw = () => revealNextHint();
window.__judgeInk = (ch) => judgeHandwriting(inkStrokes, ch || (currentItem() && currentItem().char), inkSize, inkPadding);

function flipHwRecord(ok) {
  if (!session) return;
  if (!session.hwResult || !session.hwResult.recorded) {
    session.hwResult = session.hwResult || { passed: ok, writingOk: ok, mistakes: 0, recorded: false };
    recordHwResult(ok);
    session.hwResult.passed = ok;
    return;
  }
  const last = session.answers[session.answers.length - 1];
  if (!last || last.ok === ok) {
    session.hwResult.passed = ok;
    return;
  }
  const item = currentItem();
  const card = cardOf(item.char);
  const hist = todayHistory();
  const today = todayStr();
  if (ok) {
    hist.wrong = Math.max(0, hist.wrong - 1);
    hist.correct += 1;
    card.wrongs = Math.max(0, card.wrongs - 1);
    card.rights += 1;
    state.profile.totalWrong = Math.max(0, state.profile.totalWrong - 1);
    state.profile.totalCorrect += 1;
    state.profile.coins += 5;
    hist.coins += 5;
    card.status = "learning";
    card.inWrongBook = false;
    card.intervalIndex = Math.min(Math.max(0, card.intervalIndex), INTERVALS.length - 1);
    card.due = addDays(today, INTERVALS[card.intervalIndex]);
    session.wrong = Math.max(0, session.wrong - 1);
    session.correct += 1;
  } else {
    hist.correct = Math.max(0, hist.correct - 1);
    hist.wrong += 1;
    card.rights = Math.max(0, card.rights - 1);
    card.wrongs += 1;
    state.profile.totalCorrect = Math.max(0, state.profile.totalCorrect - 1);
    state.profile.totalWrong += 1;
    card.status = "learning";
    card.inWrongBook = true;
    card.intervalIndex = 0;
    card.due = addDays(today, INTERVALS[0]);
    session.correct = Math.max(0, session.correct - 1);
    session.wrong += 1;
  }
  last.ok = ok;
  session.hwResult.passed = ok;
  saveState();
}

function recordHwResult(ok) {
  if (!session || !session.hwResult) return;
  if (session.hwResult.recorded) return;
  const item = currentItem();
  markCard(item, ok);
  session.hwResult.recorded = true;
  session.hwResult.passed = ok;
  if (ok) {
    session.correct += 1;
    if (cardOf(item.char).inWrongBook && cardOf(item.char).status !== "mastered") {
      if (cardOf(item.char).rights > cardOf(item.char).wrongs) cardOf(item.char).inWrongBook = false;
      saveState();
    }
  } else {
    session.wrong += 1;
  }
  session.answers.push({ char: item.char, ok, auto: true, hints: session.hwResult.hints || 0 });
}

function celebrateLight() {
  const pad = document.getElementById("pad");
  if (!pad) return;
  pad.style.boxShadow = "0 0 0 4px rgba(34,197,94,0.45), 0 10px 30px rgba(37,99,235,0.12)";
}

function retryHandwrite() {
  session.hwResult = null;
  session.revealed = false;
  resetInkState();
  render();
}


/* canvas */
function setupCanvas() {
  const cvs = document.getElementById("hw");
  if (!cvs) return;
  const pad = document.getElementById("pad");
  const rect = pad.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  cvs.width = Math.floor(rect.width * dpr);
  cvs.height = Math.floor(rect.height * dpr);
  const ctx = cvs.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1e3a6e";
  canvasState = { ctx, drawing: false, w: rect.width, h: rect.height, dpr };
  const pos = (e) => {
    const r = cvs.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const start = (e) => {
    e.preventDefault();
    canvasState.drawing = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!canvasState.drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => {
    canvasState.drawing = false;
  };
  cvs.addEventListener("pointerdown", start);
  cvs.addEventListener("pointermove", move);
  cvs.addEventListener("pointerup", end);
  cvs.addEventListener("pointerleave", end);
  cvs.addEventListener("touchstart", start, { passive: false });
  cvs.addEventListener("touchmove", move, { passive: false });
  cvs.addEventListener("touchend", end);
}

function clearPad() {
  const cvs = document.getElementById("hw");
  if (!cvs || !canvasState) return;
  canvasState.ctx.clearRect(0, 0, canvasState.w, canvasState.h);
}

/* events */
function bindGlobal() {
  document.getElementById("tabbar")?.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) {
      tab = t.dataset.tab;
      render();
    }
  });
  document.getElementById("view").onclick = onViewClick;
}

function bindSession() {
  document.getElementById("view").onclick = onViewClick;
  const item = currentItem();
  const listenJudge = practiceMode() === "listen";
  if (session.done) return;
  if (session.mode === "words" || session.mode === "similar") {
    return;
  }
  if (listenJudge) {
    // 听写版在纸上书写，不初始化手写画布
  } else if (!session.hwResult) {
    setupHandwrite();
  } else if (session.hwResult && !session.hwResult.passed && (!session.hwResult.writingOk || session.hwResult.orderOk === false || session.hwResult.hintsExhausted)) {
    // 字写错 / 笔顺不对 / 提示用尽：播放正确笔顺
    const target = document.getElementById("hw-target");
    if (target && item && hasStrokeData(item.char) && typeof HanziWriter !== "undefined") {
      const size = Math.floor(target.getBoundingClientRect().width || 220);
      hwWriter = HanziWriter.create(target, item.char, {
        width: size,
        height: size,
        padding: 8,
        showCharacter: true,
        showOutline: true,
        strokeColor: "#1e3a6e",
        outlineColor: "#bfdbfe",
        strokeAnimationSpeed: 1.05,
        delayBetweenStrokes: 200,
        charDataLoader: (char, onComplete) => onComplete(STROKES[char]),
      });
      setTimeout(() => {
        try {
          const err = session.hwResult && session.hwResult.orderError;
          hwWriter.animateCharacter({
            onComplete: () => {
              if (err && typeof err.strokeNum === "number") {
                try { hwWriter.highlightStroke(err.strokeNum); } catch (e2) {}
              }
            },
          });
        } catch (e) {}
      }, 250);
    }
  }
  if (item && !session.hwResult && !session.revealed) {
    playItemIntro(item);
  }
}

function onViewClick(e) {
  const btn = e.target.closest("[data-act],[data-tab],[data-char]");
  if (!btn) return;
  if (btn.dataset.tab && !btn.dataset.act) {
    tab = btn.dataset.tab;
    render();
    return;
  }
  const act = btn.dataset.act;
  unlockSpeech();
  if (act === "set-mode") {
    setPracticeMode(btn.dataset.mode);
    if (session && session.active && !session.done && !(session.hwResult && session.hwResult.recorded)) {
      session.hwResult = null;
      session.revealed = false;
      destroyWriter();
      resetInkState();
    }
    render();
  } else if (act === "retry-hw") {
    retryHandwrite();
  } else if (act === "override") {
    flipHwRecord(btn.dataset.ok === "1");
    render();
  } else if (act === "start-new") {
    const plan = getTodayPlan();
    const g = plan.newGroups.find(groupStillOpen);
    if (!g) return showToast("今天的新学已经完成");
    startSession("pinyin", g, "新学 · 摸底");
  } else if (act === "start-review") {
    const plan = getTodayPlan();
    const g = plan.reviewGroups.find(groupStillOpen);
    if (!g) return showToast("今天的复习已经完成");
    startSession("pinyin", g, "今日复习");
  } else if (act === "placement-unit") {
    const uid = Number(btn.dataset.unit);
    const list = ALL.filter((c) => c.unitId === uid && cardOf(c.char).status === "new");
    const fallback = ALL.filter((c) => c.unitId === uid && isDue(cardOf(c.char), todayStr()));
    const queue = (list.length ? list : fallback).slice(0, GROUP_SIZE);
    startSession("pinyin", queue, `第${uid}单元摸底`);
  } else if (act === "placement-selected") {
    const list = charsInSelected().filter((c) => cardOf(c.char).status === "new");
    startSession("pinyin", list.slice(0, GROUP_SIZE), "摸底");
  } else if (act === "toggle-unit") {
    const uid = Number(btn.dataset.unit);
    const i = state.selectedUnits.indexOf(uid);
    if (i >= 0) state.selectedUnits.splice(i, 1);
    else state.selectedUnits.push(uid);
    state.selectedUnits.sort((a, b) => a - b);
    saveState();
    render();
  } else if (act === "toggle-open") {
    const uid = Number(btn.dataset.unit);
    const u = DATA.units.find((x) => x.id === uid);
    u._open = !u._open;
    render();
  } else if (act === "train") {
    startTrain(btn.dataset.mode);
  } else if (act === "practice-one") {
    const ch = ALL.find((c) => c.char === btn.dataset.char);
    startSession("pinyin", [ch], "错字练习");
  } else if (act === "show-tip") {
    showTipModal({ auto: false });
  } else if (act === "set-judge") {
    const lv = btn.dataset.level;
    if (!state.settings) state.settings = { practiceMode: practiceMode() };
    state.settings.judgeLevel = (lv === "normal" || lv === "strict") ? lv : "easy";
    saveState();
    render();
  } else if (act === "reset") {
    confirmReset();
  } else if (act === "quit") {
    session = null;
    render();
  } else if (act === "reveal") {
    session.revealed = true;
    render();
  } else if (act === "clear-pad") {
    if (practiceMode() === "handwrite") {
      clearInkOnly();
    } else {
      clearPad();
    }
  } else if (act === "hint-hw") {
    revealNextHint();
  } else if (act === "submit-hw") {
    submitHandwrite();
  } else if (act === "speak") {
    speak(btn.dataset.text);
  } else if (act === "speak-char") {
    const it = currentItem();
    if (it) playItemIntro(it, { force: true, charOnly: true });
  } else if (act === "speak-words") {
    const it = currentItem();
    if (it) playItemIntro(it, { force: true });
    else speakWordsSequentially([]);
  } else if (act === "mark") {
    const ok = btn.dataset.ok === "1";
    if (session.hwResult && session.hwResult.recorded) {
      if (ok !== !!session.hwResult.passed) flipHwRecord(ok);
      nextQuestion();
      return;
    }
    const item = currentItem();
    markCard(item, ok);
    if (ok) {
      session.correct += 1;
      if (cardOf(item.char).inWrongBook && cardOf(item.char).status !== "mastered") {
        // after a correct answer, keep in wrong book until mastered or 2 consecutive? We'll remove if correct and rights>wrongs
        if (cardOf(item.char).rights > cardOf(item.char).wrongs) cardOf(item.char).inWrongBook = false;
        saveState();
      }
    } else session.wrong += 1;
    session.answers.push({ char: item.char, ok });
    nextQuestion();
  } else if (act === "choose") {
    const i = Number(btn.dataset.i);
    const choice = session.choices[i];
    const item = currentItem();
    const ok = !!choice.ok;
    session.choices.forEach((c) => {
      if (c.ok) c.cls = "ok";
    });
    if (!ok) choice.cls = "bad";
    session.revealed = true;
    markCard(item, ok);
    if (ok) session.correct += 1;
    else session.wrong += 1;
    render();
  } else if (act === "next") {
    nextQuestion();
  } else if (act === "finish") {
    session = null;
    tab = "home";
    render();
  } else if (act === "more-group") {
    const list = charsInSelected().filter((c) => cardOf(c.char).status === "new").slice(0, GROUP_SIZE);
    startSession("pinyin", list, session.title || "摸底");
  }
}

function startTrain(mode) {
  const selected = charsInSelected();
  let list = [];
  let title = "训练";
  if (mode === "wrong") {
    list = ALL.filter((c) => cardOf(c.char).inWrongBook && cardOf(c.char).status !== "mastered");
    title = "错字巩固";
    startSession("pinyin", shuffle(list).slice(0, 12), title);
    return;
  }
  if (mode === "similar") {
    list = selected.filter((c) => c.similar && c.similar.length);
    if (list.length < 4) list = selected;
    title = "形近字辨析";
    const q = shuffle(list).slice(0, 8);
    startSession("similar", q, title);
    return;
  }
  if (mode === "words") {
    list = shuffle(selected.filter((c) => c.words && c.words.length)).slice(0, 8);
    title = "组词选择";
    startSession("words", list, title);
    return;
  }
  if (mode === "dictation") {
    title = "听写";
    list = shuffle(selected).slice(0, 8);
    startSession("dictation", list, title);
    return;
  }
  if (mode === "pinyin") {
    title = "看拼音写字";
    list = shuffle(selected).slice(0, 8);
    startSession("pinyin", list, title);
    return;
  }
}

function clientEnv() {
  const ua = navigator.userAgent || "";
  const isWeChat = /MicroMessenger/i.test(ua);
  const isAlipay = /AlipayClient|AliApp\(AP/i.test(ua);
  const isMobile = isWeChat || isAlipay || /Android|iPhone|iPod|iPad|Mobile|HarmonyOS|OpenHarmony/i.test(ua);
  return { isWeChat, isAlipay, isMobile };
}

function markTipShown() {
  if (!state.settings) state.settings = {};
  state.settings.tipLastDate = todayStr();
  saveState();
}

function maybeShowTipPrompt() {
  if (!session || !session.done) return;
  if ((session.queue || []).length < GROUP_SIZE) return;
  if (state.settings && state.settings.tipLastDate === todayStr()) return;
  setTimeout(() => showTipModal({ auto: true }), 700);
}

function qrCardHtml(kind, src, label) {
  return `<div class="qr-card ${kind}"><img src="${src}" alt="${label}" width="200" height="200"><span class="qlab">${label}</span></div>`;
}

function openAlipayPay() {
  const httpsUrl = TIP_PAY.alipay;
  const scheme = "alipays://platformapi/startapp?saId=10000007&qrcode=" + encodeURIComponent(httpsUrl);
  if (clientEnv().isAlipay) {
    window.location.href = httpsUrl;
    return;
  }
  window.location.href = scheme;
  setTimeout(() => {
    if (document.visibilityState === "visible") {
      window.location.href = httpsUrl;
    }
  }, 900);
}

function showTipModal(opts = {}) {
  const auto = !!opts.auto;
  const root = document.getElementById("modal-root");
  if (!root) return;
  const env = clientEnv();
  if (auto) markTipShown();

  let body = "";
  let action = "";
  if (env.isWeChat) {
    body = `<div class="qr-row">${qrCardHtml("wechat", TIP_PAY.wechatImg, "微信支付")}</div>
      <p class="qr-hint">长按识别二维码</p>`;
  } else if (env.isMobile) {
    body = `<div class="qr-row">${qrCardHtml("alipay", TIP_PAY.alipayImg, "支付宝")}</div>
      <p class="qr-hint">打不开时可保存或截图扫码</p>`;
    action = `<button class="cta cta-full alipay-cta" type="button" id="tip-alipay">打开支付宝请客</button>`;
  } else {
    body = `<div class="qr-row">
      ${qrCardHtml("wechat", TIP_PAY.wechatImg, "微信支付")}
      ${qrCardHtml("alipay", TIP_PAY.alipayImg, "支付宝")}
    </div>
    <p class="qr-hint">用手机扫一扫即可打赏</p>`;
  }

  root.className = "show";
  root.innerHTML = `<div class="sheet center-card tip-sheet">
    <div class="tip-bento" aria-hidden="true">🍱</div>
    <h3>如果觉得还不错，<br>请开发者吃份便当吧！</h3>
    <p class="tip-sub">随意就好，谢谢你的鼓励</p>
    ${body}
    ${action}
    <button class="tip-later" type="button" id="tip-later">下次再说</button>
  </div>`;

  const close = () => {
    root.className = "";
    root.innerHTML = "";
    root.onclick = null;
  };
  root.onclick = (e) => {
    if (e.target === root) close();
  };
  document.getElementById("tip-later").onclick = close;
  const payBtn = document.getElementById("tip-alipay");
  if (payBtn) payBtn.onclick = () => openAlipayPay();
}
window.__showTipModal = (auto) => showTipModal({ auto: !!auto });
window.__clientEnv = clientEnv;

function confirmReset() {
  const root = document.getElementById("modal-root");
  root.className = "show";
  root.innerHTML = `<div class="sheet center-card">
    <h3>清空学习进度？</h3>
    <p class="h-sub">生字数据和单元选择会保留，打卡、小星星和错字本会清零。</p>
    <div class="actions" style="margin-top:16px">
      <button class="cta ghost" id="cancel-reset">取消</button>
      <button class="cta orange" id="ok-reset">确定清空</button>
    </div>
  </div>`;
  root.onclick = (e) => {
    if (e.target === root) {
      root.className = "";
      root.innerHTML = "";
    }
  };
  document.getElementById("cancel-reset").onclick = () => {
    root.className = "";
    root.innerHTML = "";
  };
  document.getElementById("ok-reset").onclick = () => {
    const units = state.selectedUnits.slice();
    const settings = Object.assign({}, state.settings);
    state = defaultState();
    state.selectedUnits = units;
    state.settings = settings;
    state.onboarded = true;
    saveState();
    root.className = "";
    root.innerHTML = "";
    showToast("进度已清空");
    render();
  };
}

function showOnboard() {
  if (state.onboarded) return;
  const root = document.getElementById("modal-root");
  root.className = "show";
  root.innerHTML = `<div class="sheet">
    <div class="center">${pandaSVG().replace('width="168"', "")}</div>
    <h3>你好，欢迎来到千词斩</h3>
    <p class="h-sub" style="margin:8px 0 12px">用间隔复习记住三年级的会写字。先勾选要摸底的单元（已默认 1–7 单元，第七单元建议优先）。本册共 8 个单元。</p>
    <p class="note" style="margin-bottom:14px"><strong>示例整理</strong>：生字表根据公开写字表整理，组词为常用示例，请以课本为准。</p>
    <button class="cta cta-full green" id="go-onboard">开始吧</button>
  </div>`;
  document.getElementById("go-onboard").onclick = () => {
    unlockSpeech();
    state.onboarded = true;
    saveState();
    root.className = "";
    root.innerHTML = "";
    tab = "study";
    render();
  };
}

function setupViewport() {
  const apply = () => {
    const vv = window.visualViewport;
    const h = Math.max(320, Math.round(vv && vv.height ? vv.height : window.innerHeight));
    const top = vv ? Math.max(0, Math.round(vv.offsetTop || 0)) : 0;
    const root = document.documentElement;
    root.style.setProperty("--app-h", h + "px");
    root.style.setProperty("--vv-top", top + "px");
  };
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", apply);
    window.visualViewport.addEventListener("scroll", apply);
  }
}

async function boot() {
  setupViewport();
  loadState();
  setupSpeechUnlock();
  try {
    const [res, strokeRes] = await Promise.all([
      fetch("./data/characters.json"),
      fetch("./data/strokes.json"),
    ]);
    DATA = await res.json();
    STROKES = await strokeRes.json();
  } catch (e) {
    document.getElementById("view").innerHTML = `<div class="empty"><h3>数据加载失败</h3><p>请检查 data/characters.json</p></div>`;
    return;
  }
  ALL = flatten(DATA);
  render();
  showOnboard();
}

boot();
