import { useState } from "react";
import { fill } from "../story/fill";
import StoryPanel from "../story/StoryPanel";
import { storiesOf, verticalFor } from "../story/stories";
import { usePack } from "../pack";
import { useStoryPrefs } from "../story/useStoryPrefs";
import { useCustomer, withVocabulary } from "../customer";

/** All talk tracks in one place, no sign-in needed. The same panels also sit on the page each story is about. */
export default function LearnPage() {
  const { id: packId } = usePack();
  const STORIES = storiesOf(packId);
  const [picked, setId] = useState(null);
  const current = STORIES.find((s) => s.id === picked) ?? STORIES[0]; // the pack arrives after the first paint, so a stale pick falls back
  const id = current.id;
  const customer = useCustomer();
  const vertical = withVocabulary(verticalFor(packId, useStoryPrefs().vertical ?? customer.vertical), customer.vocabulary);
  return (
    <main className="page">
      <h1>Learn</h1>
      <p className="lede">The stories this demo tells. Each one says who, what gets in the way, what control answers it, and what to show.</p>
      <label className="field">Story
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {STORIES.map((s) => <option key={s.id} value={s.id}>{s.id} · {fill(s.title, vertical, customer.cast)}</option>)}
        </select>
      </label>
      <StoryPanel key={id} id={id} />
      <p className="muted link-list">Pages: {current.modes.map((m) => <a key={m} href={`/${m}`}>{m}</a>)}</p>
    </main>
  );
}
