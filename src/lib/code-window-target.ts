import type { CodeViewMode } from "@/types";

export interface CodeTargetDecisionInput {
  line: number | undefined;
  nonce: number | undefined;
  viewMode: CodeViewMode;
  tokensReady: boolean;
  lastHandledNonce: number | null;
}

export function shouldHandleCodeTarget({
  line,
  nonce,
  viewMode,
  tokensReady,
  lastHandledNonce,
}: CodeTargetDecisionInput): boolean {
  return (
    typeof line === "number" &&
    line >= 1 &&
    typeof nonce === "number" &&
    viewMode === "file" &&
    tokensReady &&
    nonce !== lastHandledNonce
  );
}
