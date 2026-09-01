/**
 * L'OPTIMISEUR (v5) — multi-candidats scorés.
 *
 * Le solveur (solver.ts) produit UN plan légal par (seed, cible Monumia) ;
 * l'optimiseur parcourt une GRILLE — K seeds (`cfg.solver.candidates`) ×
 * cibles Monumia (voir monumiaTargets) — score chaque plan avec la fonction
 * objectif (objective.ts) et renvoie le meilleur. Classement :
 *   1. le moins d'erreurs de guardrail (normalement 0 partout — filet) ;
 *   2. le meilleur score total ;
 *   3. à égalité, le premier rencontré : cible la plus HAUTE (maximize), puis
 *      le k le plus bas — déterministe.
 *
 * Pourquoi une grille et pas seulement des seeds : les seeds ne font varier
 * que les égalités du glouton (quel jour pour la natation…). Le VOLUME Monumia,
 * lui, était fixé par une phase du solveur (plafond si maximize) — le score ne
 * pouvait rien contre des week-ends à 13h de Monumia. Ici le score tranche :
 * plus d'heures rapporte, mais week-end, soirées, trajets et charge totale
 * coûtent. Monumia redevient la variable d'ajustement.
 *
 * 100 % pur et déterministe : mêmes entrées → même élu. Zéro LLM.
 */

import type { LifeConfig } from "./config";
import { formatScore, scoreWeekPlan, type PlanScore } from "./objective";
import { solveWeek, type SolveArgs, type SolveResult } from "./solver";
import type { PlacementOptions } from "./josiane";

export type OptimizeResult = SolveResult & {
  score: PlanScore;
  candidatesTried: number;
  /** Cible Monumia (h) du candidat élu. */
  monumiaTargetHours: number;
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Cibles Monumia (heures/semaine) explorées, par ordre DÉCROISSANT (à score
 * égal, on garde le plus d'heures). Sans maximize : le plancher + 2h seul
 * (comportement historique). Avec : `cfg.solver.monumiaTargetsHours` si
 * renseigné, sinon 4 paliers du plancher (+2h de marge, comme le solveur) au
 * plafond, arrondis à la demi-heure.
 */
export function monumiaTargets(cfg: LifeConfig): number[] {
  const { minHoursPerWeek, maxHoursPerWeek, maximize } = cfg.work.monumia;
  const lo = Math.min(minHoursPerWeek + 2, maxHoursPerWeek);
  const hi = maxHoursPerWeek;
  if (!maximize) return [lo];
  const explicit = cfg.solver.monumiaTargetsHours;
  const values = new Set<number>();
  if (explicit && explicit.length > 0) {
    for (const h of explicit) values.add(clamp(h, lo, hi));
  } else {
    const steps = 3;
    for (let i = 0; i <= steps; i++) {
      values.add(Math.round((lo + ((hi - lo) * i) / steps) * 2) / 2);
    }
  }
  return [...values].sort((a, b) => b - a);
}

export function solveWeekBest(
  cfg: LifeConfig,
  args: SolveArgs,
  opts: PlacementOptions = {}
): OptimizeResult {
  const K = Math.max(1, cfg.solver.candidates);
  const targets = monumiaTargets(cfg);

  type Candidate = { k: number; target: number; res: SolveResult; score: PlanScore; errors: number };
  let best: Candidate | null = null;
  const rows: string[] = [];

  for (const target of targets) {
    for (let k = 0; k < K; k++) {
      // Les événements de debug des candidats sont tus (K fois le même bruit) :
      // seul le tableau récapitulatif et le verdict de l'élu sont émis.
      const res = solveWeek(cfg, {
        ...args,
        seed: `${args.input.weekStart}|v5|${k}`,
        monumiaTargetHours: target,
      });
      const score = scoreWeekPlan(cfg, args.input, res.sessions, args.fixed, res.violations);
      const errs = res.violations.filter((v) => v.severity === "error");
      const errors = errs.length;
      rows.push(
        `monumia→${target}h k=${k} erreurs=${errors} ${formatScore(score)}${
          errors ? ` — 1re erreur : [${errs[0].rule}] ${errs[0].message}` : ""
        }`
      );
      if (
        best === null ||
        errors < best.errors ||
        (errors === best.errors && score.total > best.score.total)
      ) {
        best = { k, target, res, score, errors };
      }
    }
  }

  // K ≥ 1 et au moins une cible : best est toujours renseigné.
  const elected = best!;
  opts.onEvent?.(
    "optimiseur",
    "info",
    `${rows.join("\n")}\n→ élu : monumia→${elected.target}h k=${elected.k}`
  );
  opts.onEvent?.(
    "optimiseur",
    "violations",
    elected.res.violations
      .filter((v) => v.severity === "error")
      .map((v) => `- [${v.rule}] ${v.message}`)
      .join("\n") || "(aucune erreur)"
  );

  return {
    ...elected.res,
    score: elected.score,
    candidatesTried: K * targets.length,
    monumiaTargetHours: elected.target,
  };
}
