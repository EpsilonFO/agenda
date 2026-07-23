# 🗓️ Agenda IA

Un agenda personnel **moderne** et **facilement modifiable**, piloté par un
agent IA (par défaut **GPT-5.6 Terra**, effort de raisonnement max). Tu discutes avec l'assistant en
langage naturel : il ajoute, modifie et supprime des événements, choisit
intelligemment les créneaux, et tient compte de tes préférences enregistrées.

## ✨ Fonctionnalités

- **Vue 1 / 3 / 7 jours** commutable : un sélecteur segmenté choisit le nombre de
  jours affichés. Sur mobile, la vue **3 jours** est proposée par défaut pour un
  affichage confortable ; sur grand écran, la semaine complète.
- **Interface « Liquid Glass · Deep Teal »** : fond profond, verre dépoli
  translucide (reflet spéculaire, saturation) sur toute l'UI **sauf l'agenda**
  qui reste une surface opaque et lisible ; accent teal→cyan uniforme, ligne
  « maintenant » en temps réel, micro-interactions soignées. Événements de
  l'agenda en pastilles **opaques**. Police Manrope. Sans emoji dans l'UI.
- **Dictée vocale locale (Whisper)** : le bouton micro transcrit ta demande
  directement dans le navigateur via [transformers.js](https://github.com/xenova/transformers.js).
  Aucun serveur, aucune clé API, aucune donnée envoyée — le modèle tourne
  en local (téléchargé une fois puis mis en cache).
- **Barre de prompt** ancrée en bas de l'écran sur mobile, dépliable en une
  feuille de conversation.
- **Édition manuelle** : clique sur un créneau pour créer un événement, clique
  sur un événement pour le modifier ou le supprimer.
- **Assistant IA** (chat) qui manipule l'agenda via *function calling* :
  - `list_events` — lit les créneaux occupés avant de planifier ;
  - `create_event`, `update_event`, `delete_event` ;
  - `remember` — enregistre une préférence durable.
- **Mémoire & préférences** : un espace où tu notes tes habitudes récurrentes
  (« pas de réunion avant 9h », « sport le mardi soir »…). Elles sont injectées
  dans le contexte de l'agent à chaque demande.
- **Stockage local en JSON** (`data/events.json`, `data/memory.json`) — aucune
  base de données à installer, éditable à la main.

## 🚀 Démarrage

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer la clé API OpenAI
cp .env.example .env.local
# puis renseigne OPENAI_API_KEY dans .env.local

# 3. Lancer en développement
npm run dev
```

Ouvre ensuite http://localhost:3000.

> La clé API se récupère sur https://platform.openai.com/api-keys. L'agenda fonctionne
> sans clé (création/édition manuelle), mais l'assistant IA nécessite la clé.

## ⚙️ Configuration

| Variable            | Défaut                 | Rôle                                  |
| ------------------- | ---------------------- | ------------------------------------- |
| `OPENAI_API_KEY`    | —                      | Clé API OpenAI (requise pour l'IA)    |
| `OPENAI_MODEL`      | `gpt-5.6-terra`         | Modèle utilisé par l'agent            |
| `NEXT_PUBLIC_WHISPER_MODEL` | `Xenova/whisper-base` | Modèle Whisper local (dictée)   |
| `NEXT_PUBLIC_WHISPER_LANG`  | `french`              | Langue de transcription         |

> La dictée vocale demande l'accès au micro et télécharge le modèle Whisper au
> premier usage (~150 Mo pour `whisper-base`) puis le met en cache.
> `whisper-tiny` (~75 Mo) est plus rapide,
> `whisper-small` plus précis.

## 🧱 Architecture

```
src/
├── app/
│   ├── page.tsx              # UI principale (calendrier + panneau latéral)
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── events/           # CRUD événements
│       ├── memory/           # CRUD préférences
│       └── agent/            # boucle agent OpenAI (function calling)
├── components/
│   ├── Calendar.tsx          # grille 1/3/7 jours + ligne "maintenant"
│   ├── SegmentedControl.tsx  # sélecteur de vue (1J / 3J / 7J)
│   ├── EventModal.tsx        # création / édition
│   ├── AgentChat.tsx         # chat (barre latérale bureau)
│   ├── MobileAgentBar.tsx    # barre de prompt + feuille (mobile)
│   ├── ChatMessages.tsx      # fil de messages partagé
│   ├── MicButton.tsx         # dictée vocale (Whisper local)
│   └── MemoryPanel.tsx       # mémoire & préférences
└── lib/
    ├── store.ts              # persistance JSON
    ├── agent.ts              # outils + orchestration OpenAI
    ├── dates.ts              # utilitaires de dates
    ├── useAgentChat.ts       # état de conversation partagé
    ├── useWhisper.ts         # transcription locale (transformers.js)
    └── types.ts
```

## 🛠️ Personnalisation rapide

- **Couleurs des catégories** : `CATEGORY_COLORS` dans `src/lib/agent.ts` et le
  thème dans `tailwind.config.ts`.
- **Plage horaire affichée** : `DAY_START` / `DAY_END` dans
  `src/components/Calendar.tsx`.
- **Comportement de l'assistant** : le *system prompt* dans `src/lib/agent.ts`.

## 📦 Stack

Next.js 14 (App Router) · React 18 · TypeScript · Tailwind CSS · API OpenAI.

## 📄 Licence

MIT — usage personnel libre.
