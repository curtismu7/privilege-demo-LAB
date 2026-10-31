// NOTE: the groups used here (engineers, governance-reviewers, business-analysts, compliance) are INVENTED for the demo. They are not real PingFederate or Privilege groups.
@id("u41-restricted-evidence-compliance-only")
@reason("Restricted evidence is readable by the compliance group only")
forbid (principal, action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { resource.classification == "restricted" }
unless { principal in Group::"compliance" };
