// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u20-never-merge-or-approve-pr")
@reason("Agents never merge or approve a pull request: a person does that in GitHub. No approval overrides this")
forbid (principal, action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { [Tool::"github.merge_pr", Tool::"github.approve_pr"].contains(resource) };
