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
| Monumia | **Minimum 20h/sem, plafond 30h/sem**, max 12h/jour. C'est la VARIABLE D'AJUSTEMENT : en cas de conflit, c'est toujours Monumia qu'on réduit/déplace — jamais Delos ni une sortie demandée. De préférence bibliothèque d'Orsay, possible à Paris. |
| Plan invalide | Un plan qui viole encore des règles après la boucle de réparation n'est JAMAIS auto-appliqué : il est proposé avec la liste des problèmes + bouton Valider — l'utilisateur tranche. Les sessions qui recréent un cours sont dédoublonnées en silence ; les chevauchements résiduels sacrifient la session la MOINS importante (sortie > delos > sport > monumia). |
| Horaires | Journée démarre à 8h (sport possible dès 8h). Fin **normale 21h-22h**, **minuit = exceptionnel** (échéance, semaine dense — doit rester rare et justifié). |
| Sport | Course à pied (partout), natation (**horaire fixe**, Orsay), salle de sport (fac Orsay). 3-4 séances/sem. |
| Sorties | Objectif **2 sorties/sem avec Marine** (souvent Orsay) — mais RIEN n'est inventé : seules les sorties demandées sont placées ; s'il en manque, warning. Sorties amis (plutôt Paris) quand demandées. Peut condenser/tardiver le travail. |
| Week-end | Rien avant **10h** le samedi/dimanche. Semaine d'abord : week-ends légers, Monumia le week-end seulement s'il reste des heures. |
| Trajets Delos | Pas de voiture ni POUR Y ALLER ni POUR EN REPARTIR (elle n'est pas sur place). Trajet inter-zones sur le midi = trajet + déjeuner (~2h de pause, ex: Delos matin → Orsay aprem). Les cours sans lieu dans l'agenda sont rattachés à la fac. |
| Cuisine | Budget étudiant qui mange beaucoup, adapté aux séances de sport (récup), aliments détestés bannis. |
| Déjeuner | ≥ 30 min LIBRES contiguës autour de midi. Le trajet ne mange pas la pause : changer de lieu sur le midi = trajet + 30 min de repas (Delos→Orsay ≈ 70+30). Le dîner est flexible : peut être après 22h. |
| Blocs travail | Aucun bloc Delos/Monumia < **90 min** — on ne bouche pas un creux avec une heure orpheline, on laisse libre. |
| Après le sport | **15 min** de transition (douche) avant l'activité suivante, en plus du trajet. |
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

## Phase 6 — Réglages v2 *(M)* ✅ (faite en v5, 01/09/2026)
- [x] `src/app/reglages/page.tsx` reconstruit : `LifeConfigEditor.tsx` édite la config
      ENTIÈRE par sections repliables — Rythme & horaires, Travail (Delos/Monumia/
      imprévus), Sport (quotas + activités avec perWeek/créneau imposé/ouverture),
      Sorties, Cuisine, Lieux & zones (clusters, trajets par mode, modes possédés),
      Solveur & objectif (K + poids du score).
- [x] API `GET/PUT /api/life-config` : le PUT revalide TOUT via `parseLifeConfig`
      (cohérence référentielle incluse) — une config invalide n'écrase jamais le
      fichier, les erreurs zod s'affichent telles quelles dans le bandeau.
- **Checkpoint** : Felix modifie une règle dans l'UI → le prochain plan la respecte.

## Phase 7 — Chat v2 & finitions *(M)* ✅
- [x] L'hôte du Conseil collecte un `WeekInput` structuré (fait en phase 5).
- [x] `src/lib/planner/context.ts` : contexte déterministe du jour par agent — Jannik
      voit la séance en cours avec ses exercices (workouts du plan), Simone le menu du
      jour, Emilien son bloc de travail (catégories delos/monumia/cours), Djimo les
      sorties, Josiane toute la journée + les points de vigilance du plan.
- [x] Chats individuels rebranchés : persona générée depuis la config (prompts.ts) +
      contexte du jour + mémoire. **Lecture seule** (list/resolve/remember) : toute
      modification du planning passe par Josiane ou le Conseil.
- [x] Josiane : contexte du jour + outil `replan_week` (retouche à la voix), et son
      prompt pointe vers le Conseil pour une replanification complète.
- [x] Mode `agenda` supprimé partout : ChatMode, suggestions, welcome, ChatModeSwitcher,
      MobileAgentBar (badge Josiane), summary, et historiques/sessions purgés des data.
- [x] Stubs de la phase 0 retirés (plus aucun « en reconstruction » côté chat),
      build et 70 tests verts.
- **Checkpoint final** : relecture d'ensemble, THEME.md ↔ config ↔ comportement alignés.
  Reste la **phase 6** (réglages) — dernière phase ouverte.

---

## Risques identifiés

- **Variété vs guardrails** : si Josiane viole souvent les mêmes règles, la boucle de
  réparation va lisser les plans (moins de variété). Acceptable — la variété légitime
  vit dans les choix valides, pas dans les erreurs.
- **Fiabilité JSON du modèle** : couverte par zod + retry ; si un agent échoue
  durablement, monter son modèle via la config `MODELS` (déjà par variable d'env).
- **Pendant la construction** (phases 0→4), l'app n'a pas de planificateur — assumé,
  Felix ne l'utilise pas en ce moment.
- **Monumia « minimum 20h » sans maximum** : le garde-fou humain, ce sont les bornes
  horaires (22h normal), les 2 sorties, le sport et le seuil d'exceptionnel — c'est eux
  qui bornent le haut, pas un plafond arbitraire.

---

# PLAN v5 — Placement 100 % déterministe, multi-candidats scorés (31/08/2026) ✅

> Décidée le 31/08/2026 : la « discussion » du Conseil disparaît, plus aucun LLM ne
> participe au placement. Le seul rôle LLM restant : REMPLIR des JSON validés —
> la `WeekInput` à l'entrée (le greffier du mode council) et les `RetouchOp[]` à la
> retouche. Le placement est un exercice d'optimisation sous contrainte : les
> contraintes sont `data/life-config.json` + la demande hebdo structurée.

## Architecture v5

- **`optimize.ts` (nouveau)** : `solveWeekBest` — K candidats (`cfg.solver.candidates`,
  seeds `${weekStart}|v5|${k}`), scorés par la fonction objectif, le meilleur gagne
  (tri : moins d'erreurs guardrails, puis score, puis k le plus bas). Déterministe.
- **`objective.ts` (nouveau)** : `scoreWeekPlan` — fonction pure, poids dans
  `life-config.json` (`solver.objective`) : warns, trous résiduels, Monumia au-dessus
  du plancher, sport étalé, jours off, travail le week-end, fins tardives, Delos groupé.
  Un poids à 0 éteint le terme ; chaque terme est tracé (trace de debug).
- **`solver.ts`** : plus aucun brief LLM. Choix des sports = rotation config
  (`perWeek` par activité) surchargée par `WeekInput.sport` (`exclure`/`imposer` —
  seule voie pour une activité « optionnel »). Imprévus sans volume :
  `work.imprevus.defaultHours`. Le crochet `decisions` survit comme entrée PURE (tests).
- **`josiane.ts`** : `placeWeek` = overrides + indisponibilités + `solveWeekBest`.
  **Morts** : `placeWeekDecisions` (v4), `placeWeekLLM` (v2), `repair.ts`, la boucle de
  réparation, `dropFixedDuplicates`, `forceRequestedSorties`. **Vit** : la retouche
  (`retouchWeek` : le LLM remplit des ops, les guardrails revalident, seules les
  violations INTRODUITES bloquent).
- **`council.ts`** : `runCouncil` = `placeWeek` + mapping WeekPlan. Morts : émetteurs
  (Emilien/Jannik/Djimo), Simone, transcript, workouts, coachNote. Les champs WeekPlan
  correspondants sont legacy (lecture seule des plans historiques — rien ne casse).
- **`agent.ts`** : l'hôte council devient un GREFFIER du planificateur (prompt sans
  roster, liste des activityId injectée, paramètre `sport` sur `propose_week_plan`,
  repli « retry sans sport » dans `toWeekInput`). Mode josiane inchangé.
- **Les 4 chats individuels restent** (lecture seule, contexte du jour) — seuls
  survivants « personnages » avec la Josiane de retouche.
- **Guardrails inchangés** (l'oracle), à un correctif près : un bloc d'INDISPONIBILITÉ
  (`FixedItem.indispo`) n'exige plus de pause déjeuner (bug latent v2-v4).

## Réglages (life-config.json)

- `solver.candidates` (8) et `solver.objective.*` (les poids) — à calibrer à l'usage.
- `sport.activities[].perWeek` (course 2, natation 1, salle 1) — la rotation.
- `work.imprevus.defaultHours` (2).

## Risques v5

- **Convergence inter-semaines** : le score peut élire la même structure chaque
  semaine — la variété est un sous-produit, plus une garantie. Option future : terme
  de dissimilarité vs semaine précédente.
- **Poids mal calibrés** = plans légaux mais moches — réversible dans life-config.json
  sans code ; la trace montre le tableau des K candidats et leurs scores.

**Phase 6 (réglages) : faite le 01/09/2026** — `LifeConfigEditor.tsx` +
`/api/life-config`, toutes les sections y compris `solver` (poids) et `perWeek`.
Plus aucune phase ouverte.

## Post-mortem du premier run réel (semaine 2026-09-07, corrigé le 01/09/2026)

Cours tous les matins 9h-12h → plan raté. Sept correctifs, tous couverts par le
test de régression `solver.regression.test.ts` (« cours tous les matins ») :

1. **Delos 0/2** : le repli seedé n'acceptait que les jours VIERGES — il pose
   désormais sur tout jour où un gabarit passe `conflicts()` (l'après-midi
   14-18 après un cours 9-12).
2. **Consignes sans levier** : nouveaux overrides hebdo `delosGroupHalfDays`
   et `delosWeekendOk` (le placement se surcharge, le QUOTA jamais) + réglage
   config `work.delos.weekendOk`, guardrail `delos-weekend` passé en warn quand
   toléré. Greffier informé (prompt + schéma d'outil).
3. **Déjeuners de 30 min** : le déjeuner se réserve en 1re passe AVANT Delos
   distant et le sport, et se colle à la FIN du bloc du matin (on mange en
   sortant du cours).
4. **Trou fantôme** : plus de crédit déjeuner dans `conflicts()`/`checkTravel`
   quand un repas est déjà posé ce jour-là (miroir solveur ↔ guardrails).
5. **2 sports le même jour** : le tri des jours était cassé (dist=Infinity →
   clés toutes à -Infinity → choix aléatoire) ; réparé + étalement vs TOUTES
   les séances. Et l'objectif `sportEtalement` mesurait l'écart entre jours
   DISTINCTS (récompensait l'empilement) → par séance (même jour = 0).
6. **Semaine dense** : seuil `work.monumia.weekdayComfortHoursPerDay` (6h,
   config + UI) — au-delà on déborde sur le week-end avant de densifier.
7. **Trace réinstrumentée** : la WeekInput du greffier et les événements fixes
   sont à nouveau dans la trace (`planificateur/request`).

---

# v5.1 — Trajets, volume Monumia élu par le score, décisions exposées (01/09/2026) ✅

> Revue du 01/09/2026 sur les plans réels : les plans étaient légaux mais moches, pour
> trois raisons — le déjeuner sans lieu rendait les trajets invisibles (et un plan
> infaisable de 10 min passait), les K seeds ne faisaient varier que des égalités du
> glouton (le volume Monumia était fixé à 30h par une phase), et les trajets n'étaient
> pas scorés. Décisions de Felix : le trajet de la VEILLE au soir est la norme (jamais
> pénalisé, jamais de trajet du matin), et il EXISTE toujours — une soirée jusqu'à 23h59
> est écourtée du temps de trajet.

## Déterministe

- **Déjeuner localisé** (`reserveLunch`) : le repas porte le lieu du bloc qu'il
  prolonge, validé par `conflicts()`, raccourci par pas de 15 min jusqu'au minimum si un
  trajet inter-zones suit (cours Orsay 12h → déjeuner 12h-12h45 → RER → Delos 14h).
  Jamais à la salle de sport ; sur un jour vide, à midi (plus 11h45) là où on bossera.
- **Chaîne des trajets à travers les blocs sans lieu** : `conflicts()` ET `checkTravel`
  (miroir) mesurent le trajet depuis le dernier bloc LOCALISÉ, en déduisant le temps
  qu'occupent les blocs sans lieu intercalés.
- **`buildTravelEvents` exporté, réécrit** : suit la POSITION et la VOITURE (elle reste
  là où on l'a laissée : Orsay → Delos en RER ⇒ retour en RER 70 min ; la veille en
  voiture vers la base Paris ⇒ retour en voiture). Un trajet de veille va à la BASE de
  la zone (lieu `sleepable`), pas au lieu de travail du lendemain. Il existe toujours :
  la dernière session est écourtée si la soirée court trop tard (jamais un fixe — signalé).
  Un trajet plus long que le battement réservé est affiché et signalé (`notes`).
- **Objectif** : nouveaux termes `trajets` (par trajet + par heure — le RER coûte plus
  que la voiture) et `charge` (cours + Delos + Monumia + imprévus au-delà de
  `chargeSeuilHeures`). Poids revus dans life-config.json : week-end 4, fin tardive 3.
- **Optimiseur = grille** seeds × cibles Monumia (`monumiaTargets` : 22, 24.5, 27.5, 30h
  par défaut, ou `solver.monumiaTargetsHours`) ; à score égal la cible la plus haute
  gagne. Le score élit désormais le VOLUME : 22h en semaine de cours quotidiens, 27.5h en
  semaine vide. `maximize: false` = plancher + 2h seul (historique).
- **Delos à distance** : ordre des jours mélangé par le RNG (les candidats varient).
- **Sport** : le repli « fin d'après-midi » ne tombe plus sur le créneau du midi.
- **Week-end** : samedi d'abord, dimanche libre si possible (plus de 2h + 2h).

## Agentique

- **`WeekInput.decisions`** (delos / sport / sorties) : le greffier peut enfin
  transmettre « Delos mardi et jeudi », « muscu jeudi soir ». Une décision infaisable est
  rejetée AVEC sa raison, remontée dans les warnings (`rejected` n'était pas relayé).
- **`sortiesDatees[].zone`** : la zone d'une sortie « autre » est demandée quand elle
  n'est ni dite ni évidente (sans elle, aucun trajet autour de la sortie).
- **`overrides.monumiaMaxHours`** : « semaine légère » plafonne les cibles explorées.
- **Plus d'auto-commit** : `propose_week_plan` et `replan_week` PROPOSENT (carte +
  bouton Valider, `/api/plan/commit`). `edit_plan_sessions` (ops précises) reste appliqué
  directement.
- **Replanification par re-solve** (`replanInput` + `replanPlanFromStore`) : le LLM
  traduit la consigne en PATCH de la demande d'origine (stockée avec le plan :
  `WeekPlan.input`), la semaine entière est re-résolue. Repli sur la retouche par
  opérations pour les plans historiques sans demande stockée.
- **Trajets régénérés** après toute retouche (ils étaient orphelins). Transparence :
  surcharge sport affichée comme les overrides ; `WeekPlan.summary` (volumes, jours Delos,
  trajets, candidats) relayé par le greffier et affiché dans la carte.

## Réglages

- `solver.monumiaTargetsHours` (optionnel), `solver.objective.trajetParTrajet` (3),
  `trajetParHeure` (4), `chargeSeuilHeures` (45), `chargeParHeure` (4) — tous dans
  l'éditeur `/reglages`.
- ⚠️ À arbitrer par Felix : `work.monumia.weekendMaxHoursPerDay` vaut 8 alors que la note
  de la config dit « max 4h/jour ».

## Tests

`solver.trajets.test.ts` (déjeuner localisé, look-through, veille écourtée, voiture
suivie, semaine réelle 2026-09-07 via l'optimiseur complet) + cas v5.1 dans contracts,
josiane, council, objective, optimize. 177 tests verts.

## Complément v5.1 — la salle au creux de midi, Delos distant souple (01/09/2026 soir)

Retour de Felix sur le jeudi 10/09 : « Delos distant 13h15-17h15 puis salle 17h30 »
— la salle à 17h30 c'est l'heure de pointe, et une demi-journée Delos à distance peut
être « un peu à n'importe quelle heure ». Préféré : cours 9h-12h, salle 12h15, déjeuner,
Delos 15h-19h.

- **Ordre des phases** : le sport passe AVANT le Delos distant (bloc souple, horaires
  libres) et avant la 1re passe déjeuner. Le Delos distant se pose ensuite dans ce qui
  reste (15h-19h convient aussi bien que 13h-17h).
- **Creux de midi** (`placeCreux`) : une activité à lieu « pas le matin » (la salle) se
  colle au dernier bloc du matin entre 10h30 et 13h45 au plus tard — un cours qui finit à
  midi ne l'empêche plus. Pose TRANSACTIONNELLE : sans crédit déjeuner sur le battement
  d'avant (`skipLunchCredit`), puis réservation immédiate du repas ; si aucun repas ne
  peut suivre, la séance est annulée. Le déjeuner après la séance se prend SUR PLACE
  quand changer de lieu (15 min) ne tient plus — un repas entier plutôt que 30 min à 14h.
- **Heure de pointe** : nouveau champ `sport.activities[].rushHours` (souple ; salle
  17h-19h30 dans la config, à ajuster). Le solveur cherche d'abord hors pointe
  (`findSportSlot`), et l'objectif pénalise chaque heure dedans
  (`sportHeurePointeParHeure`, 6). Dans l'éditeur : toggle par activité + poids.
- Tests : `solver.sport.test.ts` (config réelle, semaine de cours quotidiens : salle
  12h15, déjeuner 13h45-14h45, travail après ; jamais en pointe), test « salle » de
  `solver.test.ts` réécrit, terme heure de pointe dans `objective.test.ts`.
