// customer.config as the page sees it (GET /api/auth/config -> customer): a name, tagline, default vertical, renamed people and nouns.
// Story text keeps its {{cast}} tokens; these overrides are applied when it is shown.
import { useCallback } from "react";
import { useSession } from "./session";

export const DEFAULT_CUSTOMER = { name: "Privilege demo LAB", tagline: "Policy on every tool call", vertical: "generic", cast: {}, vocabulary: {}, warnings: [] };

export function useCustomer() {
  const { config } = useSession();
  return { ...DEFAULT_CUSTOMER, ...(config?.customer ?? {}) };
}
/** A person's display name: the customer's renamed cast member if there is one, else the app's own name. */
export function useCastName() {
  const { cast } = useCustomer();
  return useCallback((id, fallback) => cast?.[id] ?? fallback, [cast]);
}
/** A vertical with the customer's vocabulary laid over it. */
export const withVocabulary = (vertical, vocabulary) => (vocabulary && Object.keys(vocabulary).length ? { ...vertical, vocab: { ...vertical.vocab, ...vocabulary } } : vertical);
