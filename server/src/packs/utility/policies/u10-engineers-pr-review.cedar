// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u10-engineers-pr-review")
@reason("Engineers may read pull requests and post review comments (repo scoping and the no-merge rules are separate forbids)")
permit (principal in Group::"engineers", action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { [Tool::"github.read_pr", Tool::"github.post_review_comment"].contains(resource) };
