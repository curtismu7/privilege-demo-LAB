// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u31-hold-requirement-update")
@reason("Updating a requirement page needs a person's approval")
@approvers("priya")
forbid (principal, action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource == Tool::"confluence.update_requirement")
unless { context.approval_count >= 1 };
