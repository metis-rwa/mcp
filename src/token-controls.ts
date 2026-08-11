import type { MintControls } from "./sources/solana.js";

export interface ControlFinding {
  key: string;
  label: string;
  /** How much power the finding hands the issuer over a holder's position.
   *  "high" means tokens can move, freeze, or stop without holder consent. */
  severity: "high" | "medium" | "info";
  detail: string;
  authority?: string | null;
}

function authorityOf(state: unknown, ...fields: string[]): string | null {
  if (!state || typeof state !== "object") return null;
  const record = state as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

interface ExtensionRule {
  label: string;
  severity:
    | ControlFinding["severity"]
    | ((state: unknown) => ControlFinding["severity"]);
  detail: (state: unknown) => string;
  authorityFields?: string[];
}

/** What each Token-2022 extension means for someone holding the token. The
 *  wording stays concrete: it says who can do what, not whether that is good. */
const EXTENSION_RULES: Record<string, ExtensionRule> = {
  permanentDelegate: {
    label: "Permanent delegate",
    severity: "high",
    authorityFields: ["delegate"],
    detail: () =>
      "A permanent delegate can transfer or burn tokens from any account without the holder signing.",
  },
  transferHook: {
    label: "Transfer hook",
    severity: (state) => (authorityOf(state, "programId") ? "high" : "medium"),
    authorityFields: ["programId", "authority"],
    detail: (state) => {
      const programId = authorityOf(state, "programId");
      return programId
        ? `Every transfer calls program ${programId}, which can reject transfers, for example to enforce an allowlist.`
        : "The extension is present but no hook program is set right now, so transfers run unchecked. The hook authority can point it at a program at any time, after which every transfer has to pass that program.";
    },
  },
  defaultAccountState: {
    label: "Default account state",
    severity: (state) =>
      authorityOf(state, "accountState") === "frozen" ? "high" : "info",
    detail: (state) => {
      const value = authorityOf(state, "accountState");
      return value === "frozen"
        ? "New token accounts start frozen, so holders can only transact after the issuer thaws them. This is a permissioned token."
        : `New token accounts start in state "${value ?? "unknown"}".`;
    },
  },
  pausableConfig: {
    label: "Pausable",
    severity: "high",
    authorityFields: ["authority"],
    detail: (state) =>
      `Transfers can be paused chain-wide by the pause authority. Currently ${
        (state as { paused?: boolean } | null)?.paused ? "paused" : "not paused"
      }.`,
  },
  mintCloseAuthority: {
    label: "Mint close authority",
    severity: "medium",
    authorityFields: ["closeAuthority"],
    detail: () => "The mint account itself can be closed once supply reaches zero.",
  },
  transferFeeConfig: {
    label: "Transfer fee",
    severity: "medium",
    authorityFields: ["transferFeeConfigAuthority"],
    detail: (state) => {
      const newer = (state as { newerTransferFee?: { transferFeeBasisPoints?: number } } | null)
        ?.newerTransferFee;
      const bps = newer?.transferFeeBasisPoints;
      return `A protocol-level fee is withheld on transfer${
        typeof bps === "number" ? ` (${bps}bps)` : ""
      }, so the amount received differs from the amount sent.`;
    },
  },
  interestBearingConfig: {
    label: "Interest bearing",
    severity: "medium",
    authorityFields: ["rateAuthority"],
    detail: () =>
      "Displayed balances accrue at a configured rate. The underlying raw balance does not change, so price feeds and balances can disagree.",
  },
  scaledUiAmountConfig: {
    label: "Scaled UI amount",
    severity: "medium",
    authorityFields: ["authority"],
    detail: () =>
      "A multiplier rescales displayed balances, which is how corporate actions such as stock splits are applied. Raw amounts stay put.",
  },
  nonTransferable: {
    label: "Non transferable",
    severity: "medium",
    detail: () => "Tokens cannot be transferred between accounts at all.",
  },
  confidentialTransferMint: {
    label: "Confidential transfers",
    severity: "medium",
    authorityFields: ["authority"],
    detail: () =>
      "Balances and transfer amounts can be encrypted, so public supply and flow analysis may be incomplete.",
  },
  confidentialMintBurn: {
    label: "Confidential mint and burn",
    severity: "medium",
    detail: () =>
      "Mints and burns can be confidential, so supply changes may not be fully observable on chain.",
  },
  memoTransfer: {
    label: "Required memo",
    severity: "info",
    detail: () => "Incoming transfers must carry a memo.",
  },
  cpiGuard: {
    label: "CPI guard",
    severity: "info",
    detail: () => "Guards accounts against certain actions performed via cross-program calls.",
  },
  immutableOwner: {
    label: "Immutable owner",
    severity: "info",
    detail: () => "Token account ownership cannot be reassigned.",
  },
  metadataPointer: {
    label: "Metadata pointer",
    severity: "info",
    authorityFields: ["metadataAddress"],
    detail: () => "Points at the account holding this token's metadata.",
  },
  tokenMetadata: {
    label: "Token metadata",
    severity: "info",
    detail: (state) => {
      const name = authorityOf(state, "name");
      const symbol = authorityOf(state, "symbol");
      return `On-chain metadata: ${name ?? "unnamed"}${symbol ? ` (${symbol})` : ""}.`;
    },
  },
  groupPointer: {
    label: "Group pointer",
    severity: "info",
    detail: () => "Points at the group account this mint belongs to.",
  },
  groupMemberPointer: {
    label: "Group member pointer",
    severity: "info",
    detail: () => "Points at this mint's group membership account.",
  },
};

export interface ControlSummary {
  program: string;
  findings: ControlFinding[];
  /** Extensions present on the mint that this build has no description for. */
  unrecognizedExtensions: string[];
  /** One line stating whether holders are exposed to issuer intervention. */
  verdict: string;
}

export function summarizeControls(controls: MintControls): ControlSummary {
  const findings: ControlFinding[] = [];

  findings.push(
    controls.mintAuthority
      ? {
          key: "mint_authority",
          label: "Mint authority",
          severity: "high",
          authority: controls.mintAuthority,
          detail:
            "Supply is not fixed. The mint authority can issue new tokens at any time, which is expected for a redeemable asset-backed token and material for anything claiming a hard cap.",
        }
      : {
          key: "mint_authority",
          label: "Mint authority",
          severity: "info",
          authority: null,
          detail: "Revoked. Supply cannot grow.",
        },
  );

  findings.push(
    controls.freezeAuthority
      ? {
          key: "freeze_authority",
          label: "Freeze authority",
          severity: "high",
          authority: controls.freezeAuthority,
          detail:
            "The freeze authority can freeze any token account, which blocks transfers and any redemption or sale from that account.",
        }
      : {
          key: "freeze_authority",
          label: "Freeze authority",
          severity: "info",
          authority: null,
          detail: "Revoked. Accounts cannot be frozen.",
        },
  );

  const unrecognizedExtensions: string[] = [];
  for (const extension of controls.extensions) {
    const rule = EXTENSION_RULES[extension.extension];
    if (!rule) {
      // Account-level extensions never appear on a mint, so anything unknown
      // here is worth surfacing rather than hiding.
      unrecognizedExtensions.push(extension.extension);
      continue;
    }
    findings.push({
      key: extension.extension,
      label: rule.label,
      severity:
        typeof rule.severity === "function"
          ? rule.severity(extension.state)
          : rule.severity,
      detail: rule.detail(extension.state),
      authority: rule.authorityFields
        ? authorityOf(extension.state, ...rule.authorityFields)
        : undefined,
    });
  }

  const high = findings.filter((f) => f.severity === "high");
  const verdict =
    high.length === 0
      ? "No issuer power over holder positions is enabled on this mint."
      : `Holders are exposed to issuer intervention through ${high.length} control${
          high.length === 1 ? "" : "s"
        }: ${high.map((f) => f.label.toLowerCase()).join(", ")}.`;

  return {
    program: controls.program,
    findings,
    unrecognizedExtensions,
    verdict,
  };
}
