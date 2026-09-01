/**
 * L'OPTIMISEUR (v5) — multi-candidats scorés.
 *
 * Le solveur (solver.ts) produit UN plan légal par seed ; l'optimiseur en
 * génère K (seeds dérivés de weekStart), les score avec la fonction objectif
 * (objective.ts) et renvoie le meilleur. Classement :
 *   1. le moins d'erreurs de guardrail (normalement 0 partout — filet) ;
 *   2. le meilleur score total ;
 *   3. le k le plus bas (ex æquo déterministe).
 *
 * 100 % pur et déterministe : mêmes entrées → même élu. Zéro LLM.
 * K vit dans cfg.solver.candidates (life-config.json).
 */

import type { LifeConfig } from "./config";
import { formatScore, scoreWeekPlan, type PlanScore } from "./objective";
import { solveWeek, type SolveArgs, type SolveResult } from "./solver";
import type { PlacementOptions } from "./josiane";

export type OptimizeResult = SolveResult & {
  score: PlanScore;
  candidatesTried: number;
};

export function solveWeekBest(
  cfg: LifeConfig,
  args: SolveArgs,
  opts: PlacementOptions = {}
): OptimizeResult {
  const K = Math.max(1, cfg.solver.candidates);

  type Candidate = { k: number; res: SolveResult; score: PlanScore; errors: number };
  let best: Candidate | null = null;
  const rows: string[] = [];

  for (let k = 0; k < K; k++) {
    // Les événements de debug des candidats sont tus (K fois le même bruit) :
    // seul le tableau récapitulatif et le verdict de l'élu sont émis.
    const res = solveWeek(cfg, { ...args, seed: `${args.input.weekStart}|v5|${k}` });
    const score = scoreWeekPlan(cfg, args.input, res.sessions, args.fixed, res.violations);
    const errors = res.violations.filter((v) => v.severity === "error").length;
    rows.push(`k=${k} erreurs=${errors} ${formatScore(score)}`);
    if (
      best === null ||
      errors < best.errors ||
      (errors === best.errors && score.total > best.score.total)
    ) {
      best = { k, res, score, errors };
    }
  }

  // K ≥ 1 garanti : best est toujours renseigné.
  const elected = best!;
  opts.onEvent?.(
    "optimiseur",
    "info",
    `${rows.join("\n")}\n→ élu : k=${elected.k}`
  );
  opts.onEvent?.(
    "optimiseur",
    "violations",
    elected.res.violations
      .filter((v) => v.severity === "error")
      .map((v) => `- [${v.rule}] ${v.message}`)
      .join("\n") || "(aucune erreur)"
  );

  return { ...elected.res, score: elected.score, candidatesTried: K };
}
