export type UniversalLogicClass = "blocker" | "permission" | "pivot";

export interface LogicClassMapping {
  domain: string;
  term: string;
  universalClass: UniversalLogicClass;
}

export const DEFAULT_LOGIC_MAPPINGS: LogicClassMapping[] = [
  // Legal domain
  { domain: "legal", term: "Statute of Limitations", universalClass: "blocker" },
  { domain: "legal", term: "Court Order", universalClass: "permission" },
  { domain: "legal", term: "Settlement Offer", universalClass: "pivot" },

  // Tech domain
  { domain: "tech", term: "API Timeout", universalClass: "blocker" },
  { domain: "tech", term: "Sudo Access", universalClass: "permission" },
  { domain: "tech", term: "Deadline Today", universalClass: "pivot" },

  // Medical domain
  { domain: "medical", term: "Contraindication", universalClass: "blocker" },
  { domain: "medical", term: "Physician Approval", universalClass: "permission" },
  { domain: "medical", term: "Patient Distress", universalClass: "pivot" },

  // Finance domain
  { domain: "finance", term: "Budget Exceeded", universalClass: "blocker" },
  { domain: "finance", term: "Manager Override", universalClass: "permission" },
  { domain: "finance", term: "Market Crash", universalClass: "pivot" },
];
