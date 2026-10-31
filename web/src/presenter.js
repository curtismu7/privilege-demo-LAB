// Presenter mode: the chrome steps back, the text grows, the talk track opens and the mode banner stays. ?presenter=1 or the header
// button turns it on; Esc or the button turns it off. Kept in the page only (the URL decides on a fresh load).
import { useSyncExternalStore } from "react";

let on = false;
const subs = new Set();
const apply = () => {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.dataset.presenter = "on"; else delete document.documentElement.dataset.presenter;
};
export function setPresenter(next) { on = Boolean(next); apply(); subs.forEach((f) => f()); }
export function initPresenter() {
  try { if (new URLSearchParams(window.location.search).get("presenter") === "1") setPresenter(true); } catch { /* no URL */ }
}
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const usePresenter = () => useSyncExternalStore(subscribe, () => on, () => false);
