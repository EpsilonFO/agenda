# 🗓️ Agenda IA

Un agenda personnel **moderne** et **facilement modifiable**, piloté par un
agent IA (par défaut **Mistral Small**). Tu discutes avec l'assistant en
langage naturel : il ajoute, modifie et supprime des événements, choisit
intelligemment les créneaux, et tient compte de tes préférences enregistrées.

![Aperçu](docs/preview.png)

## ✨ Fonctionnalités

- **Vue semaine** claire et responsive, avec pastilles de couleur par catégorie.
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

# 2. Configurer la clé API Mistral
cp .env.example .env.local
# puis renseigne MISTRAL_API_KEY dans .env.local

# 3. Lancer en développement
npm run dev
```

Ouvre ensuite http://localhost:3000.

> La clé API se récupère sur https://console.mistral.ai/. L'agenda fonctionne
> sans clé (création/édition manuelle), mais l'assistant IA nécessite la clé.

## ⚙️ Configuration

| Variable            | Défaut                 | Rôle                                  |
| ------------------- | ---------------------- | ------------------------------------- |
| `MISTRAL_API_KEY`   | —                      | Clé API Mistral (requise pour l'IA)   |
| `MISTRAL_MODEL`     | `mistral-small-latest` | Modèle utilisé par l'agent            |

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
│       └── agent/            # boucle agent Mistral (function calling)
├── components/
│   ├── Calendar.tsx          # vue semaine
│   ├── EventModal.tsx        # création / édition
│   ├── AgentChat.tsx         # chat avec l'assistant
│   └── MemoryPanel.tsx       # mémoire & préférences
└── lib/
    ├── store.ts              # persistance JSON
    ├── agent.ts              # outils + orchestration Mistral
    ├── dates.ts              # utilitaires de dates
    └── types.ts
```

## 🛠️ Personnalisation rapide

- **Couleurs des catégories** : `CATEGORY_COLORS` dans `src/lib/agent.ts` et le
  thème dans `tailwind.config.ts`.
- **Plage horaire affichée** : `DAY_START` / `DAY_END` dans
  `src/components/Calendar.tsx`.
- **Comportement de l'assistant** : le *system prompt* dans `src/lib/agent.ts`.

## 📦 Stack

Next.js 14 (App Router) · React 18 · TypeScript · Tailwind CSS · API Mistral.

## 📄 Licence

MIT — usage personnel libre.
