import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, collectionGroup, onSnapshot, query, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCd2paKL200XRdz2SwFEUzAtfg51xWL5QA",
  authDomain: "mzj-lead.firebaseapp.com",
  projectId: "mzj-lead",
  storageBucket: "mzj-lead.firebasestorage.app",
  messagingSenderId: "470098288857",
  appId: "1:470098288857:web:613125cfc1623b08abdec8",
  measurementId: "G-981Z1T6Z91"
};

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const SETTINGS_DOC = doc(db, "settings_sources", "notification_settings");
const SETTINGS_FIELD = "notificationSettings";
const SETTINGS_REFS = [SETTINGS_DOC, doc(db, "system_settings", "notification_settings"), doc(db, "system_settings", "ui_settings"), doc(db, "settings", "notification_settings")];
const SETTINGS_REF = SETTINGS_DOC;

const SOUND_PRESETS = {
  "soft-pop": { label:"Soft Pop - خفيف ومريح", kind:"beep", notes:[[620,.05,.18,"sine"],[920,.09,.12,"sine"]] },
  "classic-ding": { label:"Classic Ding - كلاسيك", kind:"beep", notes:[[1040,.08,.25,"triangle"],[1320,.10,.16,"triangle"]] },
  "message-tick": { label:"Message Tick - رسالة قصيرة", kind:"beep", notes:[[880,.035,.12,"square"],[1180,.055,.10,"square"]] },
  "cash-register": { label:"Cash Register - كاش", kind:"beep", notes:[[900,.035,.12,"triangle"],[1200,.06,.10,"triangle"],[760,.11,.14,"sine"]] },
  "clean-bell": { label:"Clean Bell - جرس واضح", kind:"beep", notes:[[740,.05,.22,"sine"],[980,.15,.22,"sine"],[1480,.22,.16,"sine"]] },
  "sparkle": { label:"Sparkle - لمعة خفيفة", kind:"beep", notes:[[1200,.02,.09,"triangle"],[1600,.08,.09,"triangle"],[1900,.15,.12,"triangle"]] },
  "urgent-double": { label:"Urgent Double - تنبيه قوي", kind:"beep", notes:[[780,.02,.15,"square"],[780,.23,.15,"square"]] },
  "sonar": { label:"Sonar - ناعم متكرر", kind:"beep", notes:[[520,.02,.28,"sine"],[520,.34,.28,"sine"]] },
  "digital": { label:"Digital - ديجيتال", kind:"beep", notes:[[1500,.02,.07,"square"],[980,.105,.07,"square"],[1320,.19,.08,"square"]] },
  "success": { label:"Success - نجاح", kind:"beep", notes:[[660,.02,.12,"sine"],[880,.13,.12,"sine"],[1180,.25,.16,"sine"]] },
  "whatsapp-lite": { label:"WhatsApp Lite - قريب من رسائل الواتساب", kind:"beep", notes:[[1050,.02,.08,"sine"],[1320,.11,.09,"sine"]] },
  "none": { label:"بدون صوت", kind:"none", notes:[] }
};

const DEFAULT_SETTINGS = {
  enabled:true,
  visualEnabled:true,
  browserNotification:false,
  style:"modern",
  position:"top-right",
  duration:15000,
  newLeadSound:"soft-pop",
  messageSound:"message-tick",
  importantSound:"urgent-double",
  volume:0.75,
  iconUrl:"",
  pageIconUrl:"",
  faviconUpdatedAt:0,
  customSoundUrl:"",
  customSoundName:"",
  newLeadTitle:"عميل جديد",
  messageTitle:"رسالة جديدة من عميل"
};

let currentSettings = { ...DEFAULT_SETTINGS };
let currentUser = null;
let audioCtx = null;
let audioUnlocked = false;
let customAudioBuffer = null;
let customAudioBufferUrl = "";
let pendingSoundKey = "";
let adminPanelMounted = false;
let leadUnsub = null;
let msgUnsub = null;
let initialLeadReady = false;
let knownLeadIds = new Set();
let initialMsgReady = false;
let knownMsgIds = new Set();
let saveTimer = null;
let mzjSelectedAssets = { customSound:null, customSoundDataUrl:"", icon:null, iconDataUrl:"", pageIcon:null, pageIconDataUrl:"" };

function getSharedAuth(){ return window.__MZJ_FIREBASE_AUTH__ || null; }
function getSharedFirestore(){
  const db = window.__MZJ_FIRESTORE_DB__;
  const docFn = window.__MZJ_FIRESTORE_DOC__;
  const setDocFn = window.__MZJ_FIRESTORE_SETDOC__;
  const getDocFn = window.__MZJ_FIRESTORE_GETDOC__;
  const serverTimestampFn = window.__MZJ_FIRESTORE_SERVER_TIMESTAMP__;
  if(db && docFn && setDocFn && getDocFn){ return { db, doc:docFn, setDoc:setDocFn, getDoc:getDocFn, serverTimestamp:serverTimestampFn }; }
  return null;
}
function getAnyCurrentUser(){
  const shared = getSharedAuth();
  return (shared && shared.currentUser) || window.__MZJ_CURRENT_USER__ || auth.currentUser || currentUser || null;
}
function waitForNotificationAuth(timeoutMs=10000){
  const ready = getAnyCurrentUser();
  if(ready){ currentUser = ready; return Promise.resolve(ready); }
  return new Promise(resolve => {
    let done = false;
    let unsubExternal = null;
    const finish = user => {
      if(done) return;
      const u = user || getAnyCurrentUser();
      if(!u && (Date.now() - started) < timeoutMs) return;
      done = true;
      try{ unsubExternal && unsubExternal(); }catch{}
      window.removeEventListener("mzj:auth-state", onSharedAuth);
      window.removeEventListener("mzj:firebase-ready", onReady);
      clearInterval(poll);
      clearTimeout(timer);
      currentUser = u || null;
      resolve(currentUser);
    };
    const started = Date.now();
    const onSharedAuth = ev => finish(ev?.detail?.user || getAnyCurrentUser());
    const onReady = () => finish(getAnyCurrentUser());
    window.addEventListener("mzj:auth-state", onSharedAuth);
    window.addEventListener("mzj:firebase-ready", onReady);
    try{ unsubExternal = onAuthStateChanged(auth, user => finish(user)); }catch{}
    const poll = setInterval(() => finish(getAnyCurrentUser()), 250);
    const timer = setTimeout(() => finish(getAnyCurrentUser()), timeoutMs);
  });
}
function safeParse(json, fallback){ try{ return JSON.parse(json) || fallback; }catch{ return fallback; } }
function loadLocal(){ return { ...DEFAULT_SETTINGS }; }
function saveLocal(settings){ /* Firestore only: no local persistent saving */ }
function isAdminHash(){ return String(location.hash || "").replace(/^#\/?/,"") === "admin"; }
function isDashboardHash(){ return String(location.hash || "").replace(/^#\/?/,"") === "dashboard" || !location.hash; }
function normalize(v){ return String(v || "").trim(); }
function leadId(d){ return normalize(d.id || d.docId || d.documentId || d.__firestoreId || d.phoneNormalized || d.phone || d.mobile || d.conversationId || d.convId); }
function leadDepartment(d){
  const raw = normalize(d.department || d.departmentKey || d.section || d.serviceKey || d.autoService || d.payment || d.leadPayment).toLowerCase();
  if(raw.includes("cash") || raw.includes("كاش")) return "cash";
  if(raw.includes("finance") || raw.includes("تمويل")) return "finance";
  if(raw.includes("service") || raw.includes("خدمة")) return "cs";
  return raw;
}
function leadStatus(d){ return normalize(d.status || d.currentStatus || d.leadStatus || d.clientStatus || d.customerStatus || d.statusLabel || "عميل جديد"); }
function isNewCashLead(d){ return leadDepartment(d) === "cash" && leadStatus(d) === "عميل جديد"; }
function customerName(d){ return normalize(d.customerName || d.name || d.fullName || d.displayName || d.leadName || "عميل بدون اسم"); }
function customerPhone(d){ const raw = normalize(d.phoneNormalized || d.phone || d.mobile || d.phoneNumber || d.customerPhone || ""); const low = raw.toLowerCase(); if(!raw || raw.includes(":") || low.includes("instagram") || low.includes("facebook") || low.includes("tiktok")) return ""; const digits = raw.replace(/[^0-9]/g, ""); return /^9665\d{8}$/.test(digits) ? digits : (/^05\d{8}$/.test(digits) ? "966" + digits.slice(1) : ""); }
function msgText(d){ return normalize(d.text || d.body || d.message || d.caption || d.content || d.lastMessageText || ""); }
function msgIsIncoming(d){
  const v = x => normalize(x).toLowerCase();
  if(d.fromAgent === true || d.isAgent === true || d.fromMe === true || d.isMine === true || d.mine === true) return false;
  if(d.sentByUid || d.sentByEmail || d.agentUid || d.adminUid || d.createdByUid || d.createdByEmail) return false;
  const direction = v(d.direction || d.messageDirection || d.dir);
  const senderType = v(d.senderType || d.role || d.authorType);
  const type = v(d.type || d.messageType || d.kind);
  if(["out","outgoing","outbound","agent","system","admin","automation","from_agent"].includes(direction)) return false;
  if(["agent","system","admin","automation"].includes(senderType) || ["agent","system","admin","automation"].includes(type)) return false;
  return true;
}

async function loadSettings(){
  currentSettings = loadLocal();
  applyPageIcon(currentSettings);
  const authUser = await waitForNotificationAuth(8000);
  if(!authUser){ renderAdminPanel(true); return; }
  try{
    const sharedFs = getSharedFirestore();
    if(sharedFs){
      const refs = [
        sharedFs.doc(sharedFs.db, "settings_sources", "notification_settings"),
        sharedFs.doc(sharedFs.db, "system_settings", "notification_settings"),
        sharedFs.doc(sharedFs.db, "system_settings", "ui_settings"),
        sharedFs.doc(sharedFs.db, "settings", "notification_settings")
      ];
      for(const refDoc of refs){
        const snap = await sharedFs.getDoc(refDoc);
        if(!snap.exists()) continue;
        const data = snap.data() || {};
        const saved = data[SETTINGS_FIELD] || data.notification_settings || data;
        if(saved && typeof saved === "object"){
          currentSettings = { ...DEFAULT_SETTINGS, ...saved };
          applyPageIcon(currentSettings);
          break;
        }
      }
    } else {
      for(const refDoc of SETTINGS_REFS){
        const snap = await getDoc(refDoc);
        if(!snap.exists()) continue;
        const data = snap.data() || {};
        const saved = data[SETTINGS_FIELD] || data.notification_settings || data;
        if(saved && typeof saved === "object"){
          currentSettings = { ...DEFAULT_SETTINGS, ...saved };
          applyPageIcon(currentSettings);
          break;
        }
      }
    }
  }catch(err){ console.warn("notification settings read skipped", err); }
  renderAdminPanel(true);
}
async function saveSettings(partial={}){
  const authUser = await waitForNotificationAuth(12000);
  if(!authUser){
    showToast({ type:"important", title:"فشل حفظ الإعدادات", body:"المستخدم غير جاهز في Firebase Auth. اعمل Refresh وسجل دخول من جديد.", sound:"urgent-double" });
    return;
  }
  const plainPayload = { ...currentSettings, ...partial, updatedAtMs: Date.now(), updatedBy: authUser.email || authUser.uid || "" };
  try{
    const sharedFs = getSharedFirestore();
    if(sharedFs){
      const ref = sharedFs.doc(sharedFs.db, "settings_sources", "notification_settings");
      await withTimeout(sharedFs.setDoc(ref, { [SETTINGS_FIELD]: plainPayload, notificationSettingsUpdatedAt: sharedFs.serverTimestamp ? sharedFs.serverTimestamp() : new Date(), updatedByUid: authUser.uid || "", updatedByEmail: authUser.email || "" }, { merge:true }), 10000, "firebase notification settings save");
    } else {
      await withTimeout(setDoc(SETTINGS_DOC, { [SETTINGS_FIELD]: plainPayload, notificationSettingsUpdatedAt: serverTimestamp(), updatedByUid: authUser.uid || "", updatedByEmail: authUser.email || "" }, { merge:true }), 10000, "firebase notification settings save");
    }
    currentSettings = { ...DEFAULT_SETTINGS, ...currentSettings, ...partial };
    const localCopy = { ...currentSettings, updatedAt: Date.now() };
    applyPageIcon(localCopy);
    showToast({ type:"important", title:"تم حفظ إعدادات الإشعارات", body:"تم حفظها داخل Firestore: settings_sources/notification_settings وتطبيقها على السيستم.", sound:"success" });
  }catch(err){
    console.error(err);
    showToast({ type:"important", title:"فشل حفظ الإعدادات", body:String(err?.message || err || "راجع Firestore Rules أو حالة تسجيل الدخول: settings_sources/notification_settings"), sound:"urgent-double" });
    throw err;
  }finally{
    renderAdminPanel(true);
  }
}
function applyPageIcon(settings){
  // Favicon فقط: هذه الصورة تخص أيقونة تبويب المتصفح، وليست أيقونة الإشعار المرئي.
  const url = settings.pageIconUrl || "";
  if(!url) return;
  const finalUrl = url.startsWith("data:") ? url : url + (url.includes("?") ? "&" : "?") + "mzjFavicon=" + encodeURIComponent(settings.faviconUpdatedAt || Date.now());
  let link = document.querySelector("link[rel~='icon']");
  if(!link){ link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
  link.type = "image/png";
  link.href = finalUrl;

  let shortcut = document.querySelector("link[rel='shortcut icon']");
  if(!shortcut){ shortcut = document.createElement("link"); shortcut.rel = "shortcut icon"; document.head.appendChild(shortcut); }
  shortcut.type = "image/png";
  shortcut.href = finalUrl;

  let apple = document.querySelector("link[rel='apple-touch-icon']");
  if(!apple){ apple = document.createElement("link"); apple.rel = "apple-touch-icon"; document.head.appendChild(apple); }
  apple.href = finalUrl;
}

function getAudioCtx(){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return null;
  if(!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

function unlockAudio(forceBeep=false){
  try{
    const ctx = getAudioCtx();
    if(!ctx) return Promise.resolve(false);
    const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    return resume.then(()=>{
      audioUnlocked = ctx.state === "running";
      // Chrome sometimes needs one silent node started from a real user gesture.
      try{
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(forceBeep ? 0.0008 : 0.00001, ctx.currentTime);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.035);
      }catch{}
      if(pendingSoundKey){
        const k = pendingSoundKey; pendingSoundKey = "";
        setTimeout(()=>playPreset(k), 40);
      }
      return audioUnlocked;
    }).catch(()=>false);
  }catch{ return Promise.resolve(false); }
}

function primeAudio(){ unlockAudio(false); }

["pointerdown","mousedown","click","touchstart","keydown"].forEach(evt=>{
  document.addEventListener(evt, primeAudio, { capture:true, passive:true });
});
window.addEventListener("focus", primeAudio, { passive:true });
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) primeAudio(); }, { passive:true });

async function decodeCustomSound(){
  try{
    const url = currentSettings.customSoundUrl || "";
    if(!url) return null;
    if(customAudioBuffer && customAudioBufferUrl === url) return customAudioBuffer;
    const ctx = getAudioCtx();
    if(!ctx) return null;
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    customAudioBuffer = await ctx.decodeAudioData(arr.slice(0));
    customAudioBufferUrl = url;
    return customAudioBuffer;
  }catch(err){
    console.warn("custom sound decode skipped", err);
    return null;
  }
}

function playBuffer(buffer, volume){
  const ctx = getAudioCtx();
  if(!ctx || !buffer) return false;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), ctx.currentTime);
  src.buffer = buffer;
  src.connect(gain); gain.connect(ctx.destination);
  src.start(ctx.currentTime + 0.01);
  return true;
}

function playPreset(soundKey){
  const volume = Number(currentSettings.volume ?? 0.75) || 0.75;
  const fallbackKey = soundKey === "custom" ? "soft-pop" : soundKey;
  const playGenerated = (key)=>{
    const preset = SOUND_PRESETS[key] || SOUND_PRESETS["soft-pop"];
    if(preset.kind === "none") return true;
    const ctx = getAudioCtx();
    if(!ctx) return false;
    const doPlay = ()=>{
      const now = ctx.currentTime + 0.015;
      preset.notes.forEach(([freq, offset, dur, type]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + offset;
        osc.type = type || "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      });
      return true;
    };
    if(ctx.state === "suspended"){
      pendingSoundKey = key;
      ctx.resume().then(()=>{ audioUnlocked = ctx.state === "running"; doPlay(); }).catch(()=>{});
      return false;
    }
    audioUnlocked = true;
    return doPlay();
  };
  try{
    if(soundKey === "custom" && currentSettings.customSoundUrl){
      decodeCustomSound().then(buf=>{
        if(buf){
          const ctx = getAudioCtx();
          if(ctx?.state === "suspended"){ pendingSoundKey = "custom"; unlockAudio(false).then(()=>playBuffer(buf, volume)); }
          else playBuffer(buf, volume);
        }else{
          playGenerated("soft-pop");
        }
      });
      return true;
    }
    return playGenerated(fallbackKey);
  }catch(err){
    console.warn("sound skipped", err);
    try{ return playGenerated("soft-pop"); }catch{}
  }
  return false;
}

function toastContainer(){
  let box = document.getElementById("mzj-notification-stack");
  if(!box){
    box = document.createElement("div");
    box.id = "mzj-notification-stack";
    document.body.appendChild(box);
  }
  box.className = "mzj-notification-stack " + (currentSettings.position || "top-right");
  return box;
}

function showToast({ type="newLead", title="إشعار", body="", sound="", iconUrl="", action=null, lead=null } = {}){
  if(!currentSettings.enabled) return;
  const soundKey = sound || (type === "message" ? currentSettings.messageSound : type === "important" ? currentSettings.importantSound : currentSettings.newLeadSound);
  primeAudio();
  playPreset(soundKey);
  setTimeout(()=>playPreset(soundKey), 180);
  if(!currentSettings.visualEnabled) return;
  const box = toastContainer();
  const item = document.createElement("button");
  item.type = "button";
  item.className = `mzj-sys-toast ${currentSettings.style || "modern"} ${type}`;
  const icon = iconUrl || currentSettings.iconUrl || "";
  item.innerHTML = `
    <span class="mzj-toast-icon">${icon ? `<img src="${escapeAttr(icon)}" alt="">` : notificationSymbol(type)}</span>
    <span class="mzj-toast-text"><b>${escapeHtml(title)}</b><small>${escapeHtml(body)}</small></span>
    <span class="mzj-toast-close">×</span>
  `;
  item.querySelector(".mzj-toast-close")?.addEventListener("click", e => { e.stopPropagation(); item.remove(); });
  item.addEventListener("click", () => {
    primeAudio();
    playPreset(soundKey);
    try{
      if(typeof action === "function") action();
      else if(lead) openLeadFromNotification(lead);
    }catch(err){ console.warn("notification click action skipped", err); }
  });
  box.appendChild(item);
  requestAnimationFrame(()=> item.classList.add("show"));
  const duration = Number(currentSettings.duration || 15000);
  setTimeout(()=> { item.classList.remove("show"); setTimeout(()=>item.remove(), 250); }, duration);
}

function notificationSymbol(type){
  if(type === "message") return "✉";
  if(type === "important") return "!";
  return "+";
}

function cleanLeadOpenPayload(data={}){
  const id = normalize(data.id || data.docId || data.documentId || data.leadId || data.leadDocId || data.customerId || data.conversationId || data.convId || "");
  return {
    id,
    docId: normalize(data.docId || data.documentId || data.leadId || data.leadDocId || id),
    conversationId: normalize(data.conversationId || data.convId || data.waConversationId || data.chatId || id),
    name: customerName(data),
    customerName: customerName(data),
    phone: customerPhone(data),
    department: leadDepartment(data),
    source: normalize(data.source || data.leadSource || data.platform || data.channel || "")
  };
}
function openLeadFromNotification(data={}){
  const payload = cleanLeadOpenPayload(data);
  try{ sessionStorage.setItem("mzj_open_lead_request", JSON.stringify({ ...payload, requestedAt: Date.now() })); }catch{}
  if(String(location.hash || "").replace(/^#\/?/,"") !== "dashboard") location.hash = "#/dashboard";
  setTimeout(()=>window.dispatchEvent(new CustomEvent("mzj:open-lead", { detail: payload })), 80);
}
function parentConversationRef(ref){
  try{ return ref?.parent?.parent || null; }catch{ return null; }
}
function dataWithRefIds(data={}, ref=null){
  const convRef = parentConversationRef(ref);
  return { ...data, id:data.id || data.docId || data.leadId || convRef?.id || "", docId:data.docId || data.leadDocId || data.leadId || convRef?.id || "", conversationId:data.conversationId || data.convId || data.chatId || convRef?.id || "" };
}
async function enrichIncomingMessage(data={}, ref=null){
  const base = dataWithRefIds(data, ref);
  const convRef = parentConversationRef(ref);
  if(!convRef) return base;
  try{
    const snap = await getDoc(convRef);
    if(snap.exists()) return { id:convRef.id, docId:convRef.id, conversationId:convRef.id, ...snap.data(), ...base };
  }catch(err){ console.warn("conversation lookup skipped", err); }
  return base;
}
function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }
function escapeAttr(s){ return escapeHtml(s).replace(/`/g, "&#096;"); }

async function fileToDataUrl(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function withTimeout(promise, ms, label="operation"){
  return Promise.race([
    promise,
    new Promise((_, reject)=>setTimeout(()=>reject(new Error(label + " timeout")), ms))
  ]);
}

async function uploadAsset(file, folder, fallbackDataUrl=""){
  // v26: Firestore only. No Firebase Storage upload at all.
  if(!file) return "";
  if(fallbackDataUrl) return fallbackDataUrl;
  return await fileToDataUrl(file);
}

function soundOptions(selected){
  const entries = Object.entries(SOUND_PRESETS).map(([key,val]) => `<option value="${key}" ${selected===key?"selected":""}>${escapeHtml(val.label)}</option>`).join("");
  return entries + `<option value="custom" ${selected==="custom"?"selected":""}>صوت مخصص مرفوع</option>`;
}

function findAdminPage(){
  if(!isAdminHash()) return null;
  return document.querySelector('.admin-page') || [...document.querySelectorAll('section.page-stack, main, #root')].find(el => /الإدارة|الفروع|حالات العملاء|المستخدمين/.test(el.textContent || '')) || null;
}

function ensureNotificationTab(adminPage){
  const tabs = adminPage?.querySelector?.('.admin-tabs');
  if(!tabs) return null;
  let btn = document.getElementById('mzjNotificationTabBtn');
  if(!btn){
    btn = document.createElement('button');
    btn.id = 'mzjNotificationTabBtn';
    btn.type = 'button';
    btn.textContent = 'إعدادات الإشعارات';
    tabs.appendChild(btn);
  }
  btn.onclick = () => activateNotificationAdminTab(true);
  [...tabs.querySelectorAll('button')].forEach(b => {
    if(b.id === 'mzjNotificationTabBtn' || b.dataset.mzjNativeTabBound === '1') return;
    b.dataset.mzjNativeTabBound = '1';
    b.addEventListener('click', () => activateNotificationAdminTab(false), true);
  });
  return btn;
}

function activateNotificationAdminTab(active){
  const adminPage = findAdminPage();
  const panel = document.getElementById('mzj-notification-admin-panel');
  const btn = document.getElementById('mzjNotificationTabBtn');
  window.__mzjNotificationAdminTabActive = !!active;
  if(adminPage) adminPage.classList.toggle('mzj-notif-tab-active', !!active);
  if(panel) panel.hidden = !active;
  if(btn) btn.classList.toggle('active', !!active);
  if(active){
    const tabs = adminPage?.querySelector?.('.admin-tabs');
    tabs?.querySelectorAll('button').forEach(b => { if(b.id !== 'mzjNotificationTabBtn') b.classList.remove('active'); });
    panel?.scrollIntoView({ behavior:'smooth', block:'start' });
  }
}

function renderAdminPanel(force=false){
  const old = document.getElementById('mzj-notification-admin-panel');
  // لا نعيد رسم لوحة الإعدادات مع كل Mutation حتى لا تغلق قوائم الاختيار أو تضيع اختيارات الملفات.
  if(old && !force){
    const adminPage = findAdminPage();
    if(adminPage) ensureNotificationTab(adminPage);
    return;
  }
  if(old && force) old.remove();
  if(!isAdminHash()) return;
  const adminPage = findAdminPage();
  if(!adminPage) return;
  const tabs = adminPage.querySelector('.admin-tabs');
  if(!tabs) return;
  ensureNotificationTab(adminPage);
  const panel = document.createElement('section');
  panel.id = 'mzj-notification-admin-panel';
  panel.className = 'mzj-notification-admin-panel';
  panel.hidden = !window.__mzjNotificationAdminTabActive;
  panel.innerHTML = `
    <div class="mzj-admin-head">
      <div><h2>إعدادات الإشعارات</h2><p>اختار صوت وشكل الإشعارات واضبط Favicon من تبويب مستقل بدون ما يكسر باقي صفحة الإدارة.</p></div>
      <button id="mzjEnableSoundBtn" type="button">تفعيل الصوت</button>
    </div>
    <div class="mzj-settings-layout">
      <div class="mzj-settings-card">
        <h3>تشغيل وشكل الإشعار</h3>
        <div class="mzj-admin-grid">
          <label>تشغيل الإشعارات<select id="mzjNotifEnabled"><option value="true">مفعل</option><option value="false">موقوف</option></select></label>
          <label>شكل الإشعار<select id="mzjNotifStyle"><option value="modern">Modern</option><option value="classic">Classic</option><option value="compact">Compact</option><option value="glass">Glass</option></select></label>
          <label>مكان الظهور<select id="mzjNotifPosition"><option value="top-right">أعلى يمين</option><option value="top-left">أعلى يسار</option><option value="bottom-right">أسفل يمين</option><option value="bottom-left">أسفل يسار</option></select></label>
          <label>مدة الإظهار<select id="mzjNotifDuration"><option value="5000">5 ثواني</option><option value="10000">10 ثواني</option><option value="15000">15 ثانية</option><option value="30000">30 ثانية</option></select></label>
        </div>
      </div>
      <div class="mzj-settings-card">
        <h3>الأصوات</h3>
        <div class="mzj-admin-grid">
          <label>صوت العميل الجديد<select id="mzjNewLeadSound">${soundOptions(currentSettings.newLeadSound)}</select></label>
          <label>صوت الرسائل<select id="mzjMessageSound">${soundOptions(currentSettings.messageSound)}</select></label>
          <label>صوت التنبيه المهم<select id="mzjImportantSound">${soundOptions(currentSettings.importantSound)}</select></label>
          <label>مستوى الصوت<input id="mzjVolume" type="range" min="0" max="1" step="0.05" value="${Number(currentSettings.volume ?? .75)}"></label>
        </div>
      </div>
      <div class="mzj-settings-card">
        <h3>الملفات المخصصة</h3>
        <div class="mzj-admin-grid">
          <label>رفع صوت إشعار مخصص<input id="mzjCustomSoundFile" type="file" accept="audio/*"></label>
          <label>أيقونة الإشعار المرئي Toast - اختياري<input id="mzjIconFile" type="file" accept="image/*"></label>
          <label>أيقونة الموقع Favicon / أيقونة تبويب المتصفح<input id="mzjPageIconFile" type="file" accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/*"></label>
        </div>
        <div class="mzj-assets-preview">
          <div><b>الصوت المخصص:</b> <span id="mzjCustomSoundName">${escapeHtml((currentSettings.customSoundName || currentSettings.customSoundUrl) ? (currentSettings.customSoundName || 'موجود') : 'غير مرفوع')}</span></div>
          <div><b>أيقونة الإشعار المرئي:</b> <img id="mzjToastIconPreview" src="${escapeAttr((currentSettings.iconUrl && currentSettings.iconUrl !== currentSettings.pageIconUrl ? currentSettings.iconUrl : ''))}" alt="notification icon" style="${(currentSettings.iconUrl && currentSettings.iconUrl !== currentSettings.pageIconUrl) ? '' : 'display:none'}"> <span id="mzjToastIconStatus">${(currentSettings.iconUrl && currentSettings.iconUrl !== currentSettings.pageIconUrl) ? 'مرفوعة' : 'غير مرفوعة'}</span></div>
          <div><b>Favicon / أيقونة تبويب المتصفح:</b> <img id="mzjFaviconPreview" src="${escapeAttr(currentSettings.pageIconUrl || '')}" alt="favicon" style="${currentSettings.pageIconUrl ? '' : 'display:none'}"> <span id="mzjFaviconStatus">${currentSettings.pageIconUrl ? 'مرفوعة' : 'غير مرفوعة'}</span></div>
        </div>
      </div>
    </div>
    <div class="mzj-preview-row">
      <button id="mzjTestNewLead" class="green" type="button">تجربة عميل جديد</button>
      <button id="mzjTestMessage" class="blue" type="button">تجربة رسالة</button>
      <button id="mzjTestImportant" class="orange" type="button">تجربة تنبيه مهم</button>
      <button id="mzjSaveNotificationSettings" class="save" type="button">حفظ الإعدادات</button>
    </div>
  `;
  tabs.insertAdjacentElement('afterend', panel);
  adminPanelMounted = true;
  const setVal = (id,val) => { const e = document.getElementById(id); if(e) e.value = String(val); };
  setVal('mzjNotifEnabled', currentSettings.enabled !== false);
  setVal('mzjNotifStyle', currentSettings.style || 'modern');
  setVal('mzjNotifPosition', currentSettings.position || 'top-right');
  setVal('mzjNotifDuration', currentSettings.duration || 15000);
  setVal('mzjVolume', currentSettings.volume ?? .75);
  document.getElementById('mzjEnableSoundBtn')?.addEventListener('click', () => { unlockAudio(true).then(()=>setTimeout(()=>playPreset('success'), 80)); });
  document.getElementById('mzjTestNewLead')?.addEventListener('click', () => showToast({ type:'newLead', title:'عميل جديد في مبيعات الكاش', body:'عميل تجربة جديد - 966500000000' }));
  document.getElementById('mzjTestMessage')?.addEventListener('click', () => showToast({ type:'message', title:'رسالة جديدة من عميل', body:'عميل تجربة: السلام عليكم، أبغى استفسر عن السيارة.' }));
  document.getElementById('mzjTestImportant')?.addEventListener('click', () => showToast({ type:'important', title:'تنبيه مهم', body:'تم حفظ الإعدادات أو يوجد إجراء مطلوب.' }));
  document.getElementById('mzjSaveNotificationSettings')?.addEventListener('click', saveFromPanel);
  bindAdminPanelLiveControls();
  activateNotificationAdminTab(!!window.__mzjNotificationAdminTabActive);
}

function readPanelValuesOnly(){
  const get = id => document.getElementById(id);
  return {
    enabled: get("mzjNotifEnabled")?.value === "true",
    style: get("mzjNotifStyle")?.value || "modern",
    position: get("mzjNotifPosition")?.value || "top-right",
    duration: Number(get("mzjNotifDuration")?.value || 15000),
    newLeadSound: get("mzjNewLeadSound")?.value || "soft-pop",
    messageSound: get("mzjMessageSound")?.value || "message-tick",
    importantSound: get("mzjImportantSound")?.value || "urgent-double",
    volume: Number(get("mzjVolume")?.value || .75)
  };
}

function bindAdminPanelLiveControls(){
  const ids = [
    "mzjNotifEnabled","mzjNotifStyle","mzjNotifPosition","mzjNotifDuration",
    "mzjNewLeadSound","mzjMessageSound","mzjImportantSound","mzjVolume"
  ];
  ids.forEach(id => {
    const field = document.getElementById(id);
    if(!field || field.dataset.mzjBound === "1") return;
    field.dataset.mzjBound = "1";
    const update = () => {
      currentSettings = { ...currentSettings, ...readPanelValuesOnly() };
      saveLocal({ ...currentSettings, updatedAt: Date.now() });
    };
    field.addEventListener("input", update);
    field.addEventListener("change", update);
  });

  const customSound = document.getElementById("mzjCustomSoundFile");
  const iconFile = document.getElementById("mzjIconFile");
  const pageIcon = document.getElementById("mzjPageIconFile");

  if(customSound && customSound.dataset.mzjBound !== "1"){
    customSound.dataset.mzjBound = "1";
    customSound.addEventListener("change", async () => {
      const f = customSound.files?.[0];
      const name = document.getElementById("mzjCustomSoundName");
      if(name) name.textContent = f ? f.name + " - جاهز للحفظ" : "غير مرفوع";
      if(f){
        mzjSelectedAssets.customSound = f;
        mzjSelectedAssets.customSoundDataUrl = await fileToDataUrl(f);
        currentSettings.customSoundUrl = mzjSelectedAssets.customSoundDataUrl;
        currentSettings.customSoundName = f.name;
        showToast({ type:"important", title:"تم اختيار صوت مخصص", body:f.name, sound:"custom" });
      }
    });
  }

  if(iconFile && iconFile.dataset.mzjBound !== "1"){
    iconFile.dataset.mzjBound = "1";
    iconFile.addEventListener("change", async () => {
      const f = iconFile.files?.[0];
      const img = document.getElementById("mzjToastIconPreview");
      const status = document.getElementById("mzjToastIconStatus");
      if(f){
        mzjSelectedAssets.icon = f;
        mzjSelectedAssets.iconDataUrl = await fileToDataUrl(f);
        currentSettings.iconUrl = mzjSelectedAssets.iconDataUrl;
        if(img){ img.src = mzjSelectedAssets.iconDataUrl; img.style.display = "inline-block"; }
        if(status) status.textContent = f.name + " - جاهزة للحفظ";
      }
    });
  }

  if(pageIcon && pageIcon.dataset.mzjBound !== "1"){
    pageIcon.dataset.mzjBound = "1";
    pageIcon.addEventListener("change", async () => {
      const f = pageIcon.files?.[0];
      const img = document.getElementById("mzjFaviconPreview");
      const status = document.getElementById("mzjFaviconStatus");
      if(f){
        mzjSelectedAssets.pageIcon = f;
        mzjSelectedAssets.pageIconDataUrl = await fileToDataUrl(f);
        currentSettings.pageIconUrl = mzjSelectedAssets.pageIconDataUrl;
        currentSettings.faviconUpdatedAt = Date.now();
        if(img){ img.src = mzjSelectedAssets.pageIconDataUrl; img.style.display = "inline-block"; }
        if(status) status.textContent = f.name + " - جاهزة للحفظ";
        applyPageIcon({ ...currentSettings, pageIconUrl:mzjSelectedAssets.pageIconDataUrl, faviconUpdatedAt:Date.now() });
      }
    });
  }
}

async function saveFromPanel(){
  const btn = document.getElementById("mzjSaveNotificationSettings");
  const oldText = btn?.textContent || "حفظ الإعدادات";
  if(btn){ btn.disabled = true; btn.textContent = "جاري الحفظ..."; }
  try{
    const partial = readPanelValuesOnly();
    const soundFile = mzjSelectedAssets.customSound || document.getElementById("mzjCustomSoundFile")?.files?.[0];
    const iconFile = mzjSelectedAssets.icon || document.getElementById("mzjIconFile")?.files?.[0];
    const pageIconFile = mzjSelectedAssets.pageIcon || document.getElementById("mzjPageIconFile")?.files?.[0];

    // v26: نثبت الملفات كـ Data URL ونحفظها في Firestore فقط. لا يوجد Storage ولا Local.
    if(soundFile){
      const dataUrl = mzjSelectedAssets.customSoundDataUrl || await fileToDataUrl(soundFile);
      partial.customSoundUrl = await uploadAsset(soundFile, "sounds", dataUrl);
      partial.customSoundName = soundFile.name;
    }
    if(iconFile){
      const dataUrl = mzjSelectedAssets.iconDataUrl || await fileToDataUrl(iconFile);
      partial.iconUrl = dataUrl;
    }
    if(pageIconFile){
      const dataUrl = mzjSelectedAssets.pageIconDataUrl || await fileToDataUrl(pageIconFile);
      // Favicon منفصل تمامًا عن أيقونة Toast. نحفظه مباشرة في إعدادات Firebase كـ Data URL
      // عشان يظهر على أي متصفح/جهاز يفتح السيستم بدون الاعتماد على Storage.
      partial.pageIconUrl = dataUrl;
      partial.faviconUpdatedAt = Date.now();
      if(partial.iconUrl === partial.pageIconUrl) delete partial.iconUrl;
      applyPageIcon({ ...currentSettings, ...partial });
    }

    await saveSettings(partial);
    mzjSelectedAssets = { customSound:null, customSoundDataUrl:"", icon:null, iconDataUrl:"", pageIcon:null, pageIconDataUrl:"" };
  }catch(err){
    console.error("notification save failed", err);
    showToast({ type:"important", title:"فشل حفظ الإعدادات", body:String(err?.message || err || "خطأ غير معروف"), sound:"urgent-double" });
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = oldText; }
  }
}

function watchAdminMount(){
  if(!isAdminHash()) return;
  if(document.getElementById("mzj-notification-admin-panel")) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => renderAdminPanel(false), 350);
}

function startLeadNotifications(){
  // Not auto-started: dashboard now uses realtime message listener only to avoid extra Firestore reads.
  if(leadUnsub) return;
  try{
    leadUnsub = onSnapshot(query(collection(db, "leads"), limit(1000)), snap => {
      const rows = [];
      snap.forEach(d => rows.push({ id:d.id, docId:d.id, ...d.data() }));
      const current = new Set(rows.map(leadId).filter(Boolean));
      if(!initialLeadReady){ knownLeadIds = current; initialLeadReady = true; return; }
      const added = [];
      snap.docChanges().forEach(ch => {
        if(ch.type !== "added") return;
        const data = { id:ch.doc.id, docId:ch.doc.id, ...ch.doc.data() };
        const id = leadId(data);
        if(id && !knownLeadIds.has(id) && isNewCashLead(data)) added.push(data);
      });
      knownLeadIds = current;
      if(added.length){
        const l = added[added.length - 1];
        showToast({ type:"newLead", title: currentSettings.newLeadTitle || "عميل جديد", body:`${customerName(l)}${customerPhone(l) ? " - " + customerPhone(l) : ""}`, lead:l });
        pulseCashCard();
      }
    });
  }catch(err){ console.warn("lead notification listener skipped", err); }
}

function startMessageNotifications(){
  if(msgUnsub) return;
  try{
    msgUnsub = onSnapshot(query(collectionGroup(db, "messages"), limit(250)), snap => {
      const current = new Set();
      snap.forEach(d => current.add(d.ref.path));
      if(!initialMsgReady){ knownMsgIds = current; initialMsgReady = true; return; }
      const fresh = [];
      snap.docChanges().forEach(ch => {
        if(ch.type !== "added") return;
        const key = ch.doc.ref.path;
        if(knownMsgIds.has(key)) return;
        const data = ch.doc.data() || {};
        if(msgIsIncoming(data)) fresh.push({ data:dataWithRefIds(data, ch.doc.ref), ref:ch.doc.ref });
      });
      knownMsgIds = current;
      if(fresh.length){
        const last = fresh[fresh.length - 1];
        enrichIncomingMessage(last.data, last.ref).then(m => {
          const name = customerName(m);
          const phone = customerPhone(m);
          const text = msgText(m).slice(0, 120) || "يوجد رسالة جديدة من عميل";
          try{ window.dispatchEvent(new CustomEvent("mzj:new-incoming-message", { detail:m })); }catch{}
          showToast({ type:"message", title: currentSettings.messageTitle || "رسالة جديدة من عميل", body:`${name}${phone ? " - " + phone : ""}
${text}`, lead:m });
        }).catch(() => {
          const m = last.data || {};
          try{ window.dispatchEvent(new CustomEvent("mzj:new-incoming-message", { detail:m })); }catch{}
          showToast({ type:"message", title: currentSettings.messageTitle || "رسالة جديدة من عميل", body:`${customerName(m)}
${msgText(m).slice(0, 120) || "يوجد رسالة جديدة من عميل"}`, lead:m });
        });
      }
    });
  }catch(err){ console.warn("message notification listener skipped", err); }
}

function pulseCashCard(){
  const cards = [...document.querySelectorAll("button, .card, [class*='card']")];
  const cash = cards.find(el => /مبيعات الكاش/.test(el.textContent || ""));
  if(cash){ cash.classList.add("mzj-cash-pulse"); setTimeout(()=>cash.classList.remove("mzj-cash-pulse"), 2500); }
}

function injectStyles(){
  if(document.getElementById("mzj-notification-plugin-style")) return;
  const style = document.createElement("style");
  style.id = "mzj-notification-plugin-style";
  style.textContent = `
    .mzj-notification-stack{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:10px;pointer-events:none;max-width:min(430px,calc(100vw - 24px));direction:rtl}
    .mzj-notification-stack.top-right{top:18px;right:18px}.mzj-notification-stack.top-left{top:18px;left:18px}.mzj-notification-stack.bottom-right{bottom:18px;right:18px}.mzj-notification-stack.bottom-left{bottom:18px;left:18px}
    .mzj-sys-toast{pointer-events:auto;border:1px solid #ead4c8;background:#fff;color:#3d160f;box-shadow:0 20px 55px rgba(45,20,16,.20);border-radius:18px;padding:13px 15px;display:grid;grid-template-columns:44px 1fr 24px;gap:10px;align-items:center;text-align:right;opacity:0;transform:translateY(-12px) scale(.98);transition:.22s ease;font-family:inherit;cursor:pointer;min-width:300px}
    .mzj-sys-toast.show{opacity:1;transform:translateY(0) scale(1)}.mzj-sys-toast.compact{grid-template-columns:34px 1fr 20px;border-radius:14px;padding:9px 10px;min-width:260px}.mzj-sys-toast.classic{border-right:7px solid #7b2d22}.mzj-sys-toast.modern{background:linear-gradient(135deg,#fff,#fff7f1)}.mzj-sys-toast.glass{background:rgba(255,255,255,.78);backdrop-filter:blur(12px)}
    .mzj-toast-icon{width:42px;height:42px;border-radius:14px;background:#7b2d22;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:24px;overflow:hidden}.compact .mzj-toast-icon{width:32px;height:32px;border-radius:10px;font-size:18px}.mzj-toast-icon img{width:100%;height:100%;object-fit:cover}.mzj-sys-toast.message .mzj-toast-icon{background:#2563eb}.mzj-sys-toast.important .mzj-toast-icon{background:#d97706}.mzj-toast-text b{display:block;font-size:16px;margin-bottom:3px}.mzj-toast-text small{display:block;color:#8f7065;line-height:1.55;font-size:13px}.mzj-toast-close{color:#7b2d22;font-weight:900;font-size:18px}.mzj-cash-pulse{animation:mzjCashPulse .75s ease 3!important}@keyframes mzjCashPulse{0%{box-shadow:0 0 0 0 rgba(123,45,34,.35)}70%{box-shadow:0 0 0 18px rgba(123,45,34,0)}100%{box-shadow:0 0 0 0 rgba(123,45,34,0)}}
    .admin-page.mzj-notif-tab-active > *:not(.admin-tabs):not(#mzj-notification-admin-panel){display:none!important}.admin-tabs #mzjNotificationTabBtn{border:1px solid #ead4c8;border-radius:14px;background:#fffaf6;color:#3d160f;font-weight:900;padding:10px 14px;cursor:pointer}.admin-tabs #mzjNotificationTabBtn.active{background:#a65344!important;color:#fff!important;border-color:#a65344!important;box-shadow:0 8px 18px rgba(123,45,34,.18)}#mzj-notification-admin-panel[hidden]{display:none!important}.mzj-notification-admin-panel{margin:14px 0 18px;padding:18px;border:1px solid #ead4c8;border-radius:22px;background:#fff;box-shadow:0 14px 32px rgba(80,32,24,.06);direction:rtl;color:#3d160f}.mzj-admin-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #f0ddd3}.mzj-admin-head h2{margin:0 0 6px;font-size:24px}.mzj-admin-head p{margin:0;color:#8f7065}.mzj-admin-head button,.mzj-preview-row button{border:1px solid #ead4c8;border-radius:13px;background:#fffaf6;color:#3d160f;font-weight:900;min-height:42px;padding:0 14px;cursor:pointer}.mzj-settings-layout{display:grid;grid-template-columns:1fr;gap:14px}.mzj-settings-card{border:1px solid #ead4c8;border-radius:18px;background:#fffaf6;padding:14px}.mzj-settings-card h3{margin:0 0 12px;color:#3d160f;font-size:18px}.mzj-admin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.mzj-admin-grid label{display:flex;flex-direction:column;gap:6px;color:#8f7065;font-weight:800}.mzj-admin-grid select,.mzj-admin-grid input[type=file]{border:1px solid #ead4c8;border-radius:13px;background:#fff;color:#3d160f;min-height:42px;padding:8px 10px;font:inherit}.mzj-admin-grid input[type=range]{width:100%;accent-color:#a65344}.mzj-preview-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;justify-content:flex-start}.mzj-preview-row .green{background:#15803d;color:#fff}.mzj-preview-row .blue{background:#2563eb;color:#fff}.mzj-preview-row .orange{background:#d97706;color:#fff}.mzj-preview-row .save{background:#7b2d22;color:#fff}.mzj-assets-preview{margin-top:14px;padding:12px;border:1px dashed #ead4c8;border-radius:16px;background:#fff;display:flex;flex-wrap:wrap;gap:16px;color:#8f7065}.mzj-assets-preview img{width:42px;height:42px;border-radius:12px;object-fit:cover;vertical-align:middle;margin-inline-start:8px;border:1px solid #ead4c8}
  `;
  document.head.appendChild(style);
}

injectStyles();
window.MZJNotifications = { showToast, playPreset, getSettings:()=>currentSettings, saveSettings };
onAuthStateChanged(auth, async user => {
  currentUser = user;
  await loadSettings();
  if(user){ startMessageNotifications(); }
});
window.addEventListener("hashchange", watchAdminMount);
new MutationObserver(watchAdminMount).observe(document.body, { childList:true, subtree:true });
setTimeout(watchAdminMount, 1200);
