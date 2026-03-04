export type ClaimStance = "for" | "against" | "neutral"

export interface Claim {
  id: string
  statement: string
  stance: ClaimStance
  evidence: string[]
  supportingComments: string[]
  counters: string[]
}

export type KeyCommentRole =
  | "defines_argument"
  | "provides_evidence"
  | "pivotal_rebuttal"
  | "introduces_topic"
  | "summarizes"

export interface KeyComment {
  commentId: string
  role: KeyCommentRole
  claimId: string
}

export interface ThreadSemantics {
  topic: string
  claims: Claim[]
  keyComments: KeyComment[]
  generatedAt: number
}
