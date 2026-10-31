// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u30-hold-story-update")
@reason("Updating an existing story needs a person's approval")
@approvers("priya")
forbid (principal, action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource == Tool::"backlog.update_story")
unless { context.approval_count >= 1 };
