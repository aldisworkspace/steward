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
  type LucideIcon,
} from "lucide-react";

export function queueIconForRule(ruleId: string | null | undefined): LucideIcon {
  if (!ruleId) return AlertTriangle;
  if (ruleId === "R-UNALLOWABLE-ALCOHOL_STAFF") return Wine;
  if (ruleId === "R-UNALLOWABLE-FUNDRAISING" || ruleId.includes("ENTERTAIN")) return Ticket;
  if (ruleId === "R-UNALLOWABLE-LOBBYING") return Landmark;
  if (ruleId.includes("TRAVEL")) return Plane;
  if (ruleId === "R-DUPLICATE") return Copy;
  if (ruleId === "R-EFFORT") return Scale;
  if (ruleId === "R-PERIOD") return CalendarX;
  if (ruleId === "R-PRIOR-APPROVAL") return Stamp;
  if (ruleId.startsWith("R-UNALLOWABLE")) return AlertTriangle;
  return AlertTriangle;
}
