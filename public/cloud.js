import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ref = (p) => doc(db, ...p.split("/"));
const read = async (p) => { const s = await getDoc(ref(p)); return s.exists() ? s.data() : null; };
const nz = (s) => String(s || "").trim().toLowerCase();
const attKey = (a) => a.date + "|" + a.gid + "|" + a.mid;
const noop = { get: async () => ({ data: () => undefined }), set: async () => {} };

const logged = (d) => ({ get: d.get, set: async (o) => { try { return await d.set(o); } catch (e) { console.error("cloud save failed", e); throw e; } } });
onAuthStateChanged(auth, (user) => { if (user) window.__cloudResolve(makeUse(user)); });

function makeUse(user) {
  let role = null, finOk = false, attLoaded = false;
  let lastMain = 0, tSeen = 0, lastTeacherPublishAt = 0;
  const pubCache = {}, synced = {};
  const hide = () => {
    const st = document.createElement("style");
    st.textContent = "#rolePreview,#teacherPreviewName{display:none!important}";
    document.head.appendChild(st);
  };

  async function publishTeachers(o) {
    let snap;
    try { snap = await getDocs(collection(db, "users")); } catch (e) { console.error("publish: cannot list users", e); return; }
    const liveR = (o.r || []).filter((r) => !r.x && !r.pl);
    const liveIds = { pv: 1 }; liveR.forEach((r) => { liveIds[r.id] = 1; });
    const gs = (o.g || []).filter((g) => !g.x && (g.p || liveIds[g.r]));
    const ms = (o.m || []).filter((m) => !m.x);
    for (const u of snap.docs) {
      const ud = u.data();
      if (ud.role !== "teacher" || !ud.teacherName) continue;
      const mine = gs.filter((g) => nz(g.tc) === nz(ud.teacherName));
      if (!mine.length) console.warn("publish: no groups matched teacher", ud.teacherName);
      const payload = {
        r: liveR,
        g: mine,
        teacherHours: (o.teacherHours || []).filter((x) => nz(x.name) === nz(ud.teacherName)),
        m: ms.filter((m) => mine.some((g) => g.id === m.g)).map((m) => ({ id: m.id, g: m.g, n: m.n, lv: m.lv })),
        cur: liveIds[o.cur] ? o.cur : (liveR[0] ? liveR[0].id : "")
      };
      const d = JSON.stringify(payload);
      if (pubCache[u.id] === d) continue;
      try {
        await setDoc(ref("teachers/" + u.id), { d, gids: mine.map((g) => g.id), updatedAt: Date.now() });
        pubCache[u.id] = d;
        console.log("published teacher doc", u.id);
      } catch (e) { console.error("publish: cannot write teacher doc", e); }
    }
  }

  const adminDoc = (id) => {
    const path = id === "all" ? "hub/main" : "hubBackups/" + id;
    return {
      get: async () => {
        const m = await read(path);
        if (id === "all" && m && m.updatedAt) lastMain = m.updatedAt;
        if (!m || id !== "all") return { data: () => m || undefined };
        let d = m.d;
        if (role === "owner") {
          try {
            const f = await read("hub/finance"); finOk = true;
            if (f && f.d) { const o = JSON.parse(d); o.finance = JSON.parse(f.d); d = JSON.stringify(o); }
          } catch (e) { finOk = false; }
        }
        if (!attLoaded || Date.now() - (window.__attAt || 0) > 60000) {
          try {
            const as = await getDocs(collection(db, "attendance"));
            const o = JSON.parse(d); o.attendance = o.attendance || [];
            const idx = {};
            o.attendance.forEach((a, i) => { idx[attKey(a)] = i; });
            as.forEach((x) => {
              const a = x.data();
              const rec = { id: x.id, date: a.date, gid: a.gid, mid: a.mid, status: a.status, teacher: a.teacher, updatedAt: a.updatedAt };
              const k = attKey(rec);
              if (k in idx) { const old = o.attendance[idx[k]]; if ((rec.updatedAt || 0) >= (old.updatedAt || 0)) o.attendance[idx[k]] = Object.assign({}, old, rec, { id: old.id || rec.id }); }
              else o.attendance.push(rec);
            });
            d = JSON.stringify(o); attLoaded = true; window.__attAt = Date.now();
          } catch (e) {}
        }
        return { data: () => ({ ...m, d }) };
      },
      set: async (obj) => {
        let o = null; try { o = JSON.parse(obj.d); } catch (e) {}
        const fin = o && o.finance ? o.finance : [];
        if (o) delete o.finance;
        const body = o ? { ...obj, d: JSON.stringify(o), updatedAt: Date.now(), by: user.email } : obj;
        await setDoc(ref(path), body);
        if (id === "all" && body && body.updatedAt) lastMain = body.updatedAt;
        if (role === "owner" && finOk && o) {
          if (id === "all") await setDoc(ref("hub/finance"), { d: JSON.stringify(fin), updatedAt: Date.now() });
          else await setDoc(ref("finBackups/" + id), { d: JSON.stringify(fin) });
        }
        if (id === "all" && o) publishTeachers(o).then(() => console.log("publishTeachers done")).catch((e) => console.error("publishTeachers failed", e));
      }
    };
  };

  const teacherDoc = (id, tname) => {
    if (id !== "all") return noop;
    return {
      get: async () => {
        const t = await read("teachers/" + user.uid);
        tSeen = (t && t.updatedAt) || 0;
        const o = t && t.d ? JSON.parse(t.d) : { r: [], g: [], m: [], teacherHours: [], cur: "" };
        o.attendance = [];
        try {
          const qs = await getDocs(query(collection(db, "attendance"), where("teacherUid", "==", user.uid)));
          qs.forEach((x) => {
            const a = x.data();
            o.attendance.push({ id: x.id, date: a.date, gid: a.gid, mid: a.mid, status: a.status, teacher: a.teacher, updatedAt: a.updatedAt });
            synced[attKey(a)] = a.status;
          });
        } catch (e) {}
        return { data: () => ({ d: JSON.stringify(o), n: 0 }) };
      },
      set: async (obj) => {
        let o = null; try { o = JSON.parse(obj.d); } catch (e) { return; }
        for (const a of (o.attendance || [])) {
          const k = attKey(a);
          if (synced[k] === a.status) continue;
          const attendanceRef = ref("attendance/" + a.date + "__" + a.gid + "__" + a.mid);
          if (!a.status) await deleteDoc(attendanceRef);
          else await setDoc(attendanceRef, {
            date: a.date, gid: a.gid, mid: a.mid, status: a.status,
            teacher: a.teacher || tname, teacherUid: user.uid, updatedAt: a.updatedAt || Date.now()
          });
          synced[k] = a.status || "";
        }
      }
    };
  };

  async function pullMain(Dd) {
    try {
      const m = await read("hub/main");
      if (!m || !m.d || !m.updatedAt) return;
      if (!lastMain) { lastMain = m.updatedAt; return; }
      if (m.updatedAt <= lastMain) return;
      lastMain = m.updatedAt;
      if (typeof window.merge3 !== "function" || typeof window.norm !== "function") return;
      const nb = window.norm(JSON.parse(m.d));
      const n = window.merge3(Dd, nb);
      window.snapBase(nb);
      try { localStorage.setItem("spk-hub", JSON.stringify(Dd)); } catch (e) {}
      if (n) {
        const ae = document.activeElement;
        const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
        if (!typing && typeof window.render === "function") window.render();
      }
    } catch (e) { console.warn("main pull failed", e); }
  }

  let tmap = null, tmapAt = 0;
  async function teacherUidFor(gid) {
    try {
      if (!tmap || Date.now() - tmapAt > 300000 || (!tmap[gid] && Date.now() - tmapAt > 20000)) {
        const qs = await getDocs(collection(db, "teachers"));
        const mp = {};
        qs.forEach((x) => { const t = x.data(); (t.gids || []).forEach((g) => { mp[g] = x.id; }); });
        tmap = mp; tmapAt = Date.now();
      }
      return tmap[gid] || "";
    } catch (e) { return ""; }
  }
  async function pushAtt(a) {
    try {
      const tu = await teacherUidFor(a.gid);
      const attendanceRef = ref("attendance/" + a.date + "__" + a.gid + "__" + a.mid);
      if (!a.status) await deleteDoc(attendanceRef);
      else await setDoc(attendanceRef, {
        date: a.date, gid: a.gid, mid: a.mid, status: a.status,
        teacher: a.teacher || "", teacherUid: tu, updatedAt: a.updatedAt || Date.now()
      });
    } catch (e) { console.warn("attendance push failed", e); }
  }

  let tAttSince = Date.now() - 600000;
  async function pullTeacherAtt(Dd) {
    try {
      if (!Dd || !Array.isArray(Dd.attendance)) return;
      const qs = await getDocs(query(collection(db, "attendance"), where("teacherUid", "==", user.uid), where("updatedAt", ">", tAttSince)));
      const idx = {};
      Dd.attendance.forEach((a, i) => { idx[attKey(a)] = i; });
      let changed = false, mx = 0;
      qs.forEach((x) => {
        const a = x.data();
        mx = Math.max(mx, a.updatedAt || 0);
        const rec = { id: x.id, date: a.date, gid: a.gid, mid: a.mid, status: a.status, teacher: a.teacher, updatedAt: a.updatedAt };
        const k = attKey(rec);
        if (k in idx) {
          const old = Dd.attendance[idx[k]];
          if (old.status === rec.status) { synced[k] = rec.status; }
          else if ((rec.updatedAt || 0) >= (old.updatedAt || 0)) {
            Dd.attendance[idx[k]] = Object.assign({}, old, rec, { id: old.id || rec.id });
            synced[k] = rec.status; changed = true;
          }
        } else { Dd.attendance.push(rec); idx[k] = Dd.attendance.length - 1; synced[k] = rec.status; changed = true; }
      });
      if (mx) tAttSince = Math.max(tAttSince, mx - 120000);
      if (changed) {
        try { localStorage.setItem("spk-hub", JSON.stringify(Dd)); } catch (e) {}
        const ae = document.activeElement;
        const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
        if (!typing && typeof window.render === "function") window.render();
      }
    } catch (e) { console.warn("teacher attendance pull failed", e); }
  }

  let tTimer = null;
  function startTeacherPoll() {
    if (tTimer) return;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const Dd = window.D;
        if (!Dd || typeof window.norm !== "function") return;
        const t = await read("teachers/" + user.uid);
        await pullTeacherAtt(Dd);
        if (!t || !t.d) return;
        const ts = t.updatedAt || 0;
        if (!ts || ts === tSeen) return;
        tSeen = ts;
        const o = JSON.parse(t.d);
        const nb = window.norm(Object.assign({}, o, { attendance: Dd.attendance || [] }));
        Dd.r = nb.r; Dd.g = nb.g; Dd.m = nb.m; Dd.cur = nb.cur;
        try { localStorage.setItem("spk-hub", JSON.stringify(Dd)); } catch (e) {}
        const ae = document.activeElement;
        const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
        if (!typing && typeof window.render === "function") window.render();
      } catch (e) { console.warn("teacher poll failed", e); }
    };
    tTimer = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  }

  let pollTimer = null;
  function startAttPoll() {
    if (pollTimer) return;
    let since = Date.now() - 600000;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const Dd = window.D;
        if (!Dd || !Array.isArray(Dd.attendance)) return;
        await pullMain(Dd);
        if ((role === "owner" || role === "admin") && Date.now() - lastTeacherPublishAt > 60000) {
          lastTeacherPublishAt = Date.now();
          await publishTeachers(Dd);
        }
        const qs = await getDocs(query(collection(db, "attendance"), where("updatedAt", ">", since)));
        const idx = {};
        Dd.attendance.forEach((a, i) => { idx[attKey(a)] = i; });
        let changed = false, mx = 0;
        qs.forEach((x) => {
          const a = x.data();
          mx = Math.max(mx, a.updatedAt || 0);
          const rec = { id: x.id, date: a.date, gid: a.gid, mid: a.mid, status: a.status, teacher: a.teacher, updatedAt: a.updatedAt };
          const k = attKey(rec);
          if (k in idx) {
            const old = Dd.attendance[idx[k]];
            if (old.status !== rec.status && (rec.updatedAt || 0) >= (old.updatedAt || 0)) {
              Dd.attendance[idx[k]] = Object.assign({}, old, rec, { id: old.id || rec.id });
              changed = true;
            }
          } else { Dd.attendance.push(rec); idx[k] = Dd.attendance.length - 1; changed = true; }
        });
        if (mx) since = Math.max(since, mx - 120000);
        if (changed) {
          try { localStorage.setItem("spk-hub", JSON.stringify(Dd)); } catch (e) {}
          const ae = document.activeElement;
          const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
          if (!typing && typeof window.render === "function") window.render();
        }
      } catch (e) { console.warn("attendance poll failed", e); }
    };
    pollTimer = setInterval(tick, 20000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  }

  return async (name) => {
    if (name === "user") return { id: async () => user.uid };
    if (name !== "db") return null;
    let ud = null;
    try { ud = await read("users/" + user.uid); } catch (e) {}
    if (ud && ud.role === "teacher") {
      role = "teacher";
      window.currentRole = "teacher";
      window.teacherName = ud.teacherName || "";
      hide();
      startTeacherPoll();
      return { collection: () => ({ doc: (id) => logged(teacherDoc(id, ud.teacherName || "")) }) };
    }
    try { await getDoc(ref("hub/main")); }
    catch (e) { window.flash = "الحساب ده مش مفعّل على النظام. كلّم الأونر."; throw e; }
    try { await read("hub/finance"); role = "owner"; } catch (e) { role = "admin"; }
    window.currentRole = role;
    if (role !== "owner") hide();
    startAttPoll(); window.spkPushAtt = pushAtt;
    return { collection: () => ({ doc: (id) => logged(adminDoc(id)) }) };
  };
}
