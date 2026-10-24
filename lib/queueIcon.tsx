import {
  AlertTriangle,
  CalendarX,
  Copy,
  Landmark,
  Plane,
  Scale,
  Stamp,
  Ticket,
  Wine,
} from "lucide-react";

const iconProps = { size: 16, strokeWidth: 1.75, "aria-hidden": true as const };

export function QueueRuleIcon({ ruleId }: { ruleId: string | null | undefined }) {
  if (!ruleId) return <AlertTriangle {...iconProps} />;
  if (ruleId === "R-UNALLOWABLE-ALCOHOL_STAFF") return <Wine {...iconProps} />;
  if (ruleId === "R-UNALLOWABLE-FUNDRAISING" || ruleId.includes("ENTERTAIN")) return <Ticket {...iconProps} />;
  if (ruleId === "R-UNALLOWABLE-LOBBYING") return <Landmark {...iconProps} />;
  if (ruleId.includes("TRAVEL")) return <Plane {...iconProps} />;
  if (ruleId === "R-DUPLICATE") return <Copy {...iconProps} />;
  if (ruleId === "R-EFFORT") return <Scale {...iconProps} />;
  if (ruleId === "R-PERIOD") return <CalendarX {...iconProps} />;
  if (ruleId === "R-PRIOR-APPROVAL") return <Stamp {...iconProps} />;
  if (ruleId.startsWith("R-UNALLOWABLE")) return <AlertTriangle {...iconProps} />;
  return <AlertTriangle {...iconProps} />;
}

/** @deprecated use QueueRuleIcon */
export function queueIconForRule(ruleId: string | null | undefined) {
  void ruleId;
  return AlertTriangle;
}
