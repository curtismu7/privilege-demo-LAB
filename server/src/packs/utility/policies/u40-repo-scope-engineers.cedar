// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u40-repo-scope-engineers")
@reason("Engineers are scoped to their team's repos (grid-ops-portal, outage-notifier); other repos are off limits")
forbid (principal in Group::"engineers", action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { resource has repo }
unless { ["grid-ops-portal", "outage-notifier"].contains(resource.repo) };
