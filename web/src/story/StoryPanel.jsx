// Pattern from id-jag-standalone web/src/story/StoryPanel.jsx. Changed: takes a story id (a page can show several),
// no presenter or customer context, choices shared through useStoryPrefs, this app's tokens.
import { useMemo, useState } from "react";
import { storiesForPage, storyById, verticalFor, verticalsOf } from "./stories";
import { usePack } from "../pack";
import { useCustomer, withVocabulary } from "../customer";
import { usePresenter } from "../presenter";
import { fillAll } from "./fill";
import { setStoryPrefs, useStoryPrefs } from "./useStoryPrefs";
import "./StoryPanel.css";

// The talk track: who the story is about, what to say at each step, and what proves it. The Allowed/Blocked switch shows
// each step's blocked wording where it has any.
export default function StoryPanel({ id, defaultOpen = true }) {
  const raw = storyById(id);
  const prefs = useStoryPrefs();
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(null);
  const { id: packId } = usePack();
  const customer = useCustomer();
  const vertical = verticalFor(packId, prefs.vertical ?? customer.vertical);
  // The customer's renamed people and nouns lie over the vertical; the story keeps its {{cast}} tokens.
  const story = useMemo(() => (raw ? fillAll(raw, withVocabulary(vertical, customer.vocabulary), customer.cast) : null), [raw, vertical, customer]);
  if (!story) return null;

  const blocked = prefs.path === "blocked";
  const current = story.steps.find((s) => s.n === active) || story.steps[0];
  const text = (step) => (blocked && step.blocked ? step.blocked : step);
  const bodyId = `story-body-${story.id}`;

  return (
    <section className="story" aria-label={`Talk track ${story.id}`} data-testid={`story-${story.id}`}>
      <header className="story__head">
        <div>
          <p className="story__eyebrow">Story {story.id} · {vertical.displayName}</p>
          <h2 className="story__title">{story.title}</h2>
        </div>
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          {open ? "Hide talk track" : "Show talk track"}
        </button>
      </header>
      {open && (
        <div id={bodyId}>
          <div className="story__controls">
            <label className="story__field">Vertical
              <select value={vertical.id} onChange={(e) => setStoryPrefs({ vertical: e.target.value })}>
                {verticalsOf(packId).map((v) => <option key={v.id} value={v.id}>{v.id === "generic" ? "Generic" : v.displayName}</option>)}
              </select>
            </label>
            <div className="story__paths" role="group" aria-label="Story path">
              <button type="button" aria-pressed={!blocked} onClick={() => setStoryPrefs({ path: "happy" })}>Allowed</button>
              <button type="button" aria-pressed={blocked} onClick={() => setStoryPrefs({ path: "blocked" })}>Blocked</button>
            </div>
          </div>
          <dl className="story__summary">
            <dt>Goal</dt><dd>{story.goal}</dd>
            <dt>Obstacle</dt><dd>{story.obstacle}</dd>
            <dt>Control</dt><dd>{story.control}</dd>
          </dl>
          <ol className="story__steps">
            {story.steps.map((s) => (
              <li key={s.n}>
                <button type="button" className="story__step" aria-current={s.n === current.n ? "step" : undefined} onClick={() => setActive(s.n)}>
                  <span className="story__n">{s.n}</span>{s.title}
                  {blocked && s.blocked && <span className="story__tag">blocked</span>}
                </button>
                {s.n === current.n && (
                  <div className="story__body">
                    <p>{text(s).tell}</p>
                    <p className="story__say"><strong>Say:</strong> “{text(s).say}”</p>
                    <p className="story__why"><strong>Why it matters:</strong> {s.why}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="story__proof"><strong>Proof:</strong> {blocked ? story.proof.blocked : story.proof.happy}</p>
          <p className="story__takeaway">“{story.say}”</p>
        </div>
      )}
    </section>
  );
}

/** Every story that names this page. */
export function PageStories({ page, defaultOpen = false }) {
  const { id: packId } = usePack();
  const presenter = usePresenter(); // presenter mode opens the talk track
  return storiesForPage(page, packId).map((s) => <StoryPanel key={`${s.id}${presenter ? "-p" : ""}`} id={s.id} defaultOpen={defaultOpen || presenter} />);
}
