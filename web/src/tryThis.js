// The Try-this scenarios of the active pack, with the customer's cast names laid over their labels and notes (same fill as the stories).
import { useMemo } from "react";
import { useCustomer, withVocabulary } from "./customer";
import { usePack } from "./pack";
import { fillAll } from "./story/fill";
import { verticalFor } from "./story/stories";
import { useStoryPrefs } from "./story/useStoryPrefs";

/** Every scenario of the pack (button ones and example-only probes), labels and notes filled. */
export function useTryThis() {
  const pack = usePack();
  const customer = useCustomer();
  const prefs = useStoryPrefs();
  const { cast, vocabulary, vertical: custVertical } = customer;
  return useMemo(() => {
    const vertical = withVocabulary(verticalFor(pack.id, prefs.vertical ?? custVertical), vocabulary);
    return (pack.tryThis ?? []).map((s) => ({ ...s, label: fillAll(s.label, vertical, cast), note: fillAll(s.note, vertical, cast), asName: fillAll(`{{${s.as}}}`, vertical, cast) }));
  }, [pack, prefs.vertical, custVertical, cast, vocabulary]);
}
