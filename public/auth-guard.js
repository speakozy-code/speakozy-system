import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

onAuthStateChanged(auth, (user) => {
  if (!user) { location.replace("/login.html"); return; }
  window.spkUser = { uid: user.uid, email: user.email };
  document.documentElement.style.visibility = "";
  const b = document.createElement("button");
  b.textContent = "تسجيل الخروج";
  b.style.cssText = "position:fixed;bottom:14px;left:14px;z-index:9999;padding:8px 14px;border-radius:10px;border:1px solid #888;background:#fff;color:#111;font:14px system-ui;cursor:pointer";
  b.onclick = () => signOut(auth).then(() => location.replace("/login.html"));
  document.body.appendChild(b);
});
