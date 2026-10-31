// The viewer's story choices (vertical pack, Allowed/Blocked) are shared by every panel on a page, so they sit in one tiny store
// backed by localStorage (storage may be blocked: then they live for the page only).
import { useSyncExternalStore } from "react";

const KEY = "privdemo.story.prefs";
let mem = { vertical: null, path: "happy" }; // vertical null = the customer's default (customer.config), else generic
const subs = new Set();

function load() {
  try { const p = JSON.parse(localStorage.getItem(KEY) || "null"); if (p && typeof p === "object") mem = { ...mem, ...p }; } catch { /* keep defaults */ }
}
load();

export function setStoryPrefs(patch) {
  mem = { ...mem, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* not remembered */ }
  subs.forEach((f) => f());
}
/** Re-read storage (tests clear it between cases). */
export function reloadStoryPrefs() { mem = { vertical: null, path: "happy" }; load(); subs.forEach((f) => f()); }

const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const useStoryPrefs = () => useSyncExternalStore(subscribe, () => mem);
