// The few words the screens keep using, in plain language. The Cedar words (permit, forbid, PEP, principal) are only secondary labels.
export const GLOSSARY = [
  { term: "Rule", cedar: null, def: "One instruction that says when a tool call is allowed, blocked or held. Every rule is checked on every call." },
  { term: "Allow rule", cedar: "permit", def: "Says which calls are allowed. A call goes ahead only if an allow rule covers it and no block rule applies." },
  { term: "Block rule", cedar: "forbid", def: "Says which calls are not allowed. A block rule always beats an allow rule, even when both apply." },
  { term: "Hold", cedar: null, def: "A block rule that names a person who can release it. The call waits until that person approves, then the rules are checked again." },
  { term: "Default deny", cedar: null, def: "If no allow rule covers a call, it is denied. Nothing is allowed just because no rule mentions it." },
  { term: "Attended", cedar: null, def: "The person makes the call themselves. The token has no agent." },
  { term: "Unattended", cedar: null, def: "An agent makes the call for the person. The token carries the agent's name. Some rules only look at unattended calls." },
  { term: "Approver", cedar: null, def: "The person a hold rule names. They answer on the Approvals page. Nobody can approve their own request." },
  { term: "Decision checkpoint", cedar: "PEP, policy enforcement point", def: "The one place every tool call passes through. It asks the rules, then runs the tool, refuses it, or holds it." },
  { term: "Who is asking", cedar: "principal", def: "The person from the sign-in token, with the groups in the token. Rules look at those groups." },
];

// The words the screens use for rules; a test pins that each one has an entry above.
export const UI_TERMS = ["Rule", "Allow rule", "Block rule", "Hold", "Default deny", "Attended", "Unattended", "Approver"];
