# PLAN — Refonte du cœur agentique (v2)

> Feuille de route de la réécriture décidée le 21/07/2026, sur la base de [THEME.md](THEME.md).
> On coche au fur et à mesure. Chaque phase se termine par un checkpoint où Felix valide.

## Décisions d'architecture (actées)

- **Réécriture à zéro du cerveau uniquement.** Le shell de l'app (calendrier, chat, sessions,
  store JSON, notifications push, auth) est conservé tel quel.
- **Le LLM place les créneaux, le code impose des guardrails.** On veut de la variété d'une
  semaine à l'autre ; l'aléatoire du modèle est une feature. En revanche le code garantit :
  pas de chevauchement, cohérence des clusters Paris/Orsay, temps de trajet respectés,
  bornes horaires, quotas, pas de trous béants.
- **Modèle de déplacement par clusters.** Deux clusters : **Orsay** (fac, bibli, chambre,
  salle de sport, chez Marine — tout à ≤15 min vélo/voiture) et **Paris** (appart parents,
  Delos — Delos inaccessible en voiture). Trajet inter-cluster : 35 min voiture / 1h10
  transports. Les journées MIXTES sont normales : le trajet Paris↔Orsay se fait très bien
  en milieu de journée (une demi-journée Delos ne bloque PAS la journée à Paris) et aussi
  le soir tard, après 22h. Ce qui est interdit : l'aller-RETOUR dans la même journée
  (Paris→Orsay→Paris). Deux demi-journées Delos le même jour = journée entière à Paris.
  Pas de nuits imposées : où dormir est un choix du planificateur.
- **Pas d'« assistant agenda » générique : c'est Josiane.** Le mode `agenda` disparaît ;
  Josiane cumule les deux rôles — gestion quotidienne de l'agenda (créer/déplacer/supprimer
  des événements) ET porte-parole du planning de semaine. Un seul interlocuteur pour l'agenda.
- **Démolition d'entrée, reconstruction sur le tas.** Felix est le seul utilisateur et
  n'utilise pas l'app en ce moment : pas besoin de garder l'ancien Conseil fonctionnel.
  On supprime le cerveau v1 dès la phase 0 et on reconstruit dans `src/lib/planner/`.
  Git garde l'historique si on veut repêcher un morceau.

## Règles de vie (source : THEME.md + précisions du 21/07)

| Domaine | Règle |
|---|---|
| Cours | ~11h/sem à Orsay, fixes, obligatoires. Peu de travail en dehors. |
| Delos | 3 demi-journées/sem, présentiel préféré, centre de Paris, **pas de voiture**. |
| Monumia | **Minimum 20h/sem**, rythme soutenu — mais humain : pas de remplissage jusqu'à minuit 7j/7. De préférence bibliothèque d'Orsay, possible à Paris. |
| Horaires | Journée démarre à 8h (sport possible dès 8h). Fin **normale 21h-22h**, **minuit = exceptionnel** (échéance, semaine dense — doit rester rare et justifié). |
| Sport | Course à pied (partout), natation (**horaire fixe**, Orsay), salle de sport (fac Orsay). 3-4 séances/sem. |
| Sorties | **≥ 2 sorties/sem avec Marine** (souvent Orsay), placées par défaut. Sorties amis (plutôt Paris) quand demandées. Peut condenser/tardiver le travail. |
| Cuisine | Budget étudiant qui mange beaucoup, adapté aux séances de sport (récup), aliments détestés bannis. |
| Déjeuner | 30 min à 1h à préserver chaque midi (fenêtre 12h-14h). Le dîner est flexible : peut être après 22h. |
| Journées | Pas obligé de remplir 8h→22h : commencer à 11h ou finir à 18h certains jours fait du bien. Les trous se mesurent ENTRE blocs de travail/sport, pas autour des sorties. |
| TP / imprévus | Plus de système de tasks/deadlines : les TP, projets et imprévus arrivent chaque semaine dans la demande faite au Conseil. |

## Ce qu'on garde / ce qu'on démolit

**Gardé tel quel** (le corps) :
`Calendar.tsx`, tous les composants de chat, `useAgentChat.ts`, `session.ts`, `summary.ts`,
`store.ts` (le pattern JSON), `dates.ts`, `commit.ts` (l'idempotence, adapté),
push/reminders, auth, PWA, l'API events.

**Démoli en phase 0** (le cerveau) :
- `src/lib/council.ts` (pipeline actuel)
- `src/lib/personas.ts` (prompts en dur)
- `src/lib/context.ts` (réécrit dans le nouveau namespace)
- Les outils `propose_week_plan`/`replan_week` de `src/lib/agent.ts` (réécrits)
- `src/app/reglages/page.tsx` (944 lignes, reconstruit en phase 6)
- Le système work-streams + tasks : API `api/work-streams`, `api/tasks`,
  `data/work-streams.json`, `data/tasks.json` (remplacés par la config + les imprévus)
- `data/profile.json` en partie absorbé par la config

---

## Phase 0 — Démolition + squelette *(S)*
- [x] Supprimer le cerveau v1 : `council.ts`, `personas.ts`, `context.ts`, les outils
      `propose_week_plan`/`replan_week` dans `agent.ts`, work-streams + tasks (API, data,
      types), et vider `reglages/page.tsx` (page placeholder).
- [x] Stubber ce qu'il faut pour que `npm run build` passe (le chat CRUD agenda reste
      fonctionnel ; les modes Conseil/agents affichent « en reconstruction »).
- [x] Créer le namespace `src/lib/planner/` (le nouveau cerveau vit là).
- [x] Ajouter `zod` (validation des sorties LLM) et `vitest` (tests des guardrails).
- **Checkpoint** : build vert, base saine.

## Phase 1 — La config de vie *(M)*
- [x] `src/lib/planner/config.ts` : types de la config (lieux + clusters, matrice de trajets
      par mode, activités, règles horaires, quotas travail/sport/sorties, cuisine).
- [x] `data/life-config.json` : seed écrit à partir de THEME.md et du tableau ci-dessus.
- [x] Zéro règle métier en dur ailleurs : tout ce qui est chiffré vit ici.
- **Checkpoint** : Felix relit `life-config.json` ligne par ligne — c'est SA config,
  elle doit se lire comme THEME.md.

## Phase 2 — Les guardrails *(M/L — le cœur du déterminisme)* ✅
- [x] `src/lib/planner/guardrails.ts` : fonctions pures `(config, sessions, fixedEvents) → Violation[]`.
      Chaque violation est typée : règle, gravité (`error` | `warn`), sessions concernées, message.
      `error` = la boucle de réparation doit corriger ; `warn` = remonté à l'utilisateur.
- [x] Règles implémentées :
  - **overlap-fixed** (error) : aucune session ne chevauche un événement fixe (cours, manuel).
  - **overlap-internal** (error) : les sessions ne se chevauchent pas entre elles.
  - **travel-time** (error) : écart ≥ trajet requis entre deux lieux (intra-cluster 15/25 min,
    inter-cluster 35/70 min). Les modes interdits par lieu sont respectés dans le calcul —
    l'interdiction voiture→Delos est appliquée ici (pas de règle séparée).
  - **cluster-pingpong** (error) : jamais Paris→Orsay→Paris dans la même journée.
  - **bounds-start / bounds-end / bounds-exceptional-count** (error) : rien avant 8h ;
    travail & sport jamais après 22h sauf session `exceptional` (max 4/sem, limite absolue
    23h59). Les sorties et repas sont EXEMPTS de la fin de journée (dîner tardif ok).
  - **lunch-break** (error) : ≥ 30 min libres chaque jour dans la fenêtre 12h-14h.
  - **big-hole** (warn) : pas de trou > 60 min entre deux blocs COMPACTABLES
    (travail/cours/sport), trajet et crédit déjeuner (60 min) déduits. Le temps libre
    avant une sortie ou en bord de journée n'est pas un trou.
  - **delos-quota** (error si <3, warn si >3) + **delos-window** (warn hors gabarit).
  - **monumia-min** (error < 20h/sem) + **monumia-daily-max** (error > 12h/jour).
  - **sport-quota** (warn hors 3-6) + **sport-recovery** (error, récup par activité)
    + **sport-opening-hours** (error) + **sport-fixed-slot** (error, ex: natation).
  - **sorties-quota** (error < 2 sorties Marine).
- [x] Tests unitaires vitest : 31 tests (semaine valide de référence + un cas de violation
      par règle), sur une config de test isolée du JSON réel.
- **Checkpoint** : Felix valide la liste des règles et leurs gravités ; `npm test` vert. ✅ tests verts

## Phase 3 — Les contrats des agents *(M)* ✅
- [x] `src/lib/planner/contracts.ts` : schémas zod de **toutes** les entrées/sorties.
      `WeekInput` (la demande hebdo structurée : imprévus, sorties datées, indisponibilités,
      dispo voiture, overrides de quotas — ex: « Marine absente » → sortiesMarineMin: 0)
      et les sorties de chaque agent.
- [x] `src/lib/planner/llm.ts` : `callJson(schema, …)` — appel Mistral en mode JSON,
      validation zod, retry avec feedback d'erreurs (2 retries), `AgentOutputError` au-delà.
      Jamais de parse silencieux.
- [x] `src/lib/planner/prompts.ts` : les system prompts sont **générés depuis la config** —
      courts (~1 écran), le caractère à la main, toutes les règles chiffrées injectées.
      Les activités sport « optionnel » sont montrées à Jannik (avec leur statut) mais
      PAS à Josiane : jamais placées par défaut.
- [x] Les 5 agents gardent leurs prénoms, leurs rôles sont recalés sur THEME.md :
  - **Emilien** (travail) : traduit la semaine en besoins — demi-journées Delos, volume
    Monumia visé, imprévus/TP de la semaine.
  - **Jannik** (sport) : choisit les 3-4 séances (natation fixe incluse), récup, exos, conseils.
  - **Djimo** (sorties) : place par défaut les 2 sorties Marine, relaie les sorties amis demandées.
  - **Josiane** (planificatrice) : voir phase 4.
  - **Simone** (cuisine) : budget étudiant, adapte aux séances, bannis les aliments détestés.
- [x] Tests : 17 tests (schémas, retry LLM avec chat simulé, injection config → prompts).
- **Checkpoint** : Felix relit chaque system prompt dans `src/lib/planner/prompts.ts`.

## Phase 4 — Josiane v2 + boucle de réparation *(L — le gros morceau)* ✅
- [x] `src/lib/planner/josiane.ts` : `placeWeek(config, {input, fixed, briefs})` —
      briefs structurés + événements fixes + demande hebdo → sessions placées.
      Température non nulle (0.5) : c'est ici que vit la variété des semaines.
      Les **overrides** hebdo sont appliqués à une copie de la config (prompts ET
      guardrails jugent pareil) ; les **indisponibilités** deviennent des blocs fixes.
- [x] La boucle : `Josiane → guardrails → erreurs ?`
      1. **Re-prompt ciblé** : uniquement les violations + le planning fautif,
         « corrige ces points, ne change rien d'autre », max 2 itérations.
      2. **Réparation mécanique** (repair.ts) : recalage heures d'ouverture,
         travail tardif écourté à la fin de journée normale, chevauchements
         résiduels supprimés. Rien de plus — pas de bricolage aveugle des quotas.
      3. Ce qui reste → **warnings honnêtes** renvoyés à l'utilisateur.
- [x] Retouche (`retouchWeek`) : opérations `move`/`remove`/`add` sur **IDs de session**,
      re-validées par les guardrails. Seules les violations INTRODUITES par la retouche
      déclenchent un re-prompt (un plan déjà imparfait ne bloque pas une retouche sans
      rapport). Pas de réparation destructive en mode retouche.
- [x] 13 tests avec chat simulé : plan valide du 1er coup, trajet corrigé au re-prompt,
      erreur persistante rattrapée mécaniquement, overrides, retouche + chevauchement.
- **Checkpoint** : on fait tourner sur la vraie semaine de Felix (dès que la phase 5
  branche le pipeline complet). C'est LE test d'acceptation de la refonte.

## Phase 5 — Orchestrateur, Simone, commit, bascule *(M)* ✅
- [x] `src/lib/planner/council.ts` : `runCouncil` — pipeline pur (émetteurs en parallèle →
      placeWeek → Simone), testable sans stockage ; wrappers `runCouncilFromStore` /
      `retouchPlanFromStore` pour les entrées/sorties réelles. Transcript de la
      délibération conservé (messages des agents vers Josiane et retours).
- [x] Le plan produit reste au format `WeekPlan` historique (sessions dénormalisées avec
      lieux, workouts, meals, groceries, transcript) → store, commit et cartes UI
      fonctionnent sans modification. Les sessions portent désormais un `id` (retouche).
- [x] Simone rebranchée : lit la semaine placée avec l'INTENSITÉ de chaque séance (depuis
      la config, pas le LLM), les jours à cours le matin (CROUS) et les indisponibilités.
      Filet déterministe anti-aliments-bannis conservé (huile d'olive épargnée).
- [x] Workouts appariés aux séances par `activityId` (fini le match par bouts de titre).
- [x] `commit.ts` : couleurs des catégories v2 (delos/monumia/sortie), purge idempotente
      `source: "plan"` inchangée.
- [x] Mode `council` du chat rebranché : l'hôte STRUCTURE la demande (imprévus, sorties
      datées, indisponibilités, voiture, overrides) dans les paramètres d'outils
      `propose_week_plan` / `replan_week`, plan auto-appliqué. `maxDuration` API → 300 s.
- [x] 7 tests orchestrateur (chat simulé multi-agents).
- **Checkpoint** : une semaine complète planifiée de bout en bout dans l'app, avec de
  VRAIS appels Mistral — le test d'acceptation de Felix.

## Phase 6 — Réglages v2 *(M)*
- [ ] Raser `src/app/reglages/page.tsx`, reconstruire section par section, chaque section
      éditant un morceau de `life-config.json` :
      1. Lieux & clusters (+ trajets, modes)
      2. Travail (Delos, Monumia, horaires)
      3. Sport (activités, statut, créneau natation)
      4. Sorties
      5. Cuisine (budget, aliments bannis)
      6. Règles horaires (bornes, seuil de trous, exceptionnel)
- [ ] Une section = une PR/un commit, validée avant la suivante.
- **Checkpoint** : Felix modifie une règle dans l'UI → le prochain plan la respecte.

## Phase 7 — Chat v2 & finitions *(M)*
- [ ] L'hôte du Conseil collecte un `WeekInput` structuré (imprévus, sorties datées,
      voiture dispo) au lieu de forwarder du texte brut.
- [ ] Contexte v2 : les chats individuels (Jannik connaît la séance en cours, Simone
      le menu du jour…) rebranchés sur le plan v2.
- [ ] Supprimer le mode `agenda` partout (ChatMode, UI, suggestions, historiques) :
      Josiane est l'unique interlocutrice agenda.
- [ ] Nettoyage final : stubs de la phase 0 retirés, aucun import mort, build propre.
- **Checkpoint final** : relecture d'ensemble, THEME.md ↔ config ↔ comportement alignés.

---

## Risques identifiés

- **Variété vs guardrails** : si Josiane viole souvent les mêmes règles, la boucle de
  réparation va lisser les plans (moins de variété). Acceptable — la variété légitime
  vit dans les choix valides, pas dans les erreurs.
- **Fiabilité JSON de mistral-small** : couverte par zod + retry ; si un agent échoue
  durablement, monter son modèle via la config `MODELS` (déjà par variable d'env).
- **Pendant la construction** (phases 0→4), l'app n'a pas de planificateur — assumé,
  Felix ne l'utilise pas en ce moment.
- **Monumia « minimum 20h » sans maximum** : le garde-fou humain, ce sont les bornes
  horaires (22h normal), les 2 sorties, le sport et le seuil d'exceptionnel — c'est eux
  qui bornent le haut, pas un plafond arbitraire.
