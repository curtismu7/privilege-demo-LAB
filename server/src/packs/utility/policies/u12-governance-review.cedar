// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u12-governance-review")
@reason("Governance reviewers may read and comment on pull requests in any repo, search the knowledge base, and ask to update a requirement")
permit (principal in Group::"governance-reviewers", action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { [Tool::"github.read_pr", Tool::"github.post_review_comment", Tool::"kb.search", Tool::"confluence.update_requirement"].contains(resource) };
