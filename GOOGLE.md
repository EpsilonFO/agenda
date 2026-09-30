# Google Calendar — brancher l'agenda sur tes calendriers Google

Objectif : tu n'utilises **que** l'agenda, mais les gens avec qui tu travailles
vivent dans Google Calendar. Une fois connecté :

- **Agenda → Google** : chaque événement de l'agenda a une copie dans le
  calendrier Google choisi. Tes collègues te voient occupé (« Trouver un
  horaire », partage de disponibilités), et tu peux **inviter des gens** depuis
  la modale d'événement ou en le demandant à Josiane — Google envoie les mails
  d'invitation, les réponses (accepté / refusé / peut-être) remontent dans
  l'agenda.
- **Google → Agenda** : les événements de ce calendrier — **invitations
  reçues** comprises — apparaissent dans l'agenda, avec une pastille et une
  bordure en pointillés tant que tu n'as pas répondu. Tu réponds depuis la
  modale (Accepté / Peut-être / Refusé). Les supprimer ici les retire aussi
  de Google (l'organisateur est prévenu).
- **Plusieurs comptes** (perso Gmail + Delos) : chacun se connecte séparément
  avec ses propres réglages. Un événement importé du compte A est aussi
  copié dans B (miroir), jamais renvoyé vers A.

Tout se règle dans **Réglages → Google Calendar**. Mais il faut d'abord créer
des identifiants OAuth côté Google : c'est la partie ci-dessous, à faire une
fois (10-15 min).

---

## 1. Côté Google Cloud (une fois)

### 1.1 Créer un projet et activer l'API

1. Ouvre <https://console.cloud.google.com/> (connecté avec le compte de ton
   choix — peu importe lequel, le projet est juste un conteneur technique).
2. Menu projet (en haut) → **Nouveau projet** → nom `Agenda` → Créer, puis
   sélectionne-le.
3. **APIs et services → Bibliothèque** → cherche **Google Calendar API** →
   **Activer**.

### 1.2 L'écran de consentement (OAuth consent screen)

Google appelle ça désormais **Google Auth Platform** (menu APIs et services →
OAuth consent screen, ou directement « Google Auth Platform »).

1. **Type d'utilisateur** : **Externe** (obligatoire si tu veux connecter un
   Gmail perso ET le compte Delos). *Interne* ne marcherait que pour des
   comptes du Workspace qui héberge le projet.
2. Renseigne : nom de l'app (`Agenda`), email d'assistance, email développeur.
   Le reste (logo, domaines) est facultatif.
3. **Champs d'application (Scopes)** : facultatif pour un usage perso, mais tu
   peux ajouter ceux que l'app demande :
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `openid`, `email`
4. **Utilisateurs test (Audience → Test users)** : ajoute **chaque adresse**
   que tu vas connecter (ton Gmail, `felixollivier@delosintelligence.fr`…).
5. **⚠️ Passe l'app « En production »** (bouton *Publish app* / *Publier
   l'application*, statut de publication). C'est **important** : en statut
   *Testing*, Google **expire les refresh tokens au bout de 7 jours** → tu
   devrais reconnecter chaque compte toutes les semaines. En production, ils
   ne périment pas.

   Pas besoin de faire vérifier l'app par Google : les portées Calendar sont
   « sensibles » mais pas « restreintes ». Conséquence visible une seule fois,
   à la connexion de chaque compte : l'écran **« Google n'a pas validé cette
   application »**. Clique **Paramètres avancés** → **Accéder à Agenda (non
   sécurisé)**. C'est normal pour une app perso non publiée sur le Store.

   Si Google refuse le passage en production tant que des champs ne sont pas
   remplis (page d'accueil, règles de confidentialité), mets l'URL de ton
   agenda (`https://agenda.monumia.fr`) dans les deux : personne ne vérifie
   pour une app à 1 utilisateur.

### 1.3 Créer l'identifiant OAuth

1. **APIs et services → Identifiants → Créer des identifiants → ID client
   OAuth**.
2. Type : **Application Web**. Nom libre.
3. **URI de redirection autorisés** — ajoute les deux, exactement :
   ```
   http://localhost:3002/api/google/callback
   https://agenda.monumia.fr/api/google/callback
   ```
   (adapte le domaine si besoin ; les « origines JavaScript » ne sont pas
   nécessaires.)
4. Créer → copie le **Client ID** et le **Client secret**.

### 1.4 Cas Google Workspace (compte Delos)

Si l'admin Workspace de Delos restreint les applications tierces (*Sécurité →
Contrôle des accès aux API*), la connexion du compte `@delosintelligence.fr`
peut être bloquée (« Cette application est bloquée »). Deux issues : l'admin
autorise l'app (il faut lui donner le Client ID), ou il laisse les utilisateurs
autoriser eux-mêmes les apps demandant des portées Calendar. Ton Gmail perso,
lui, n'a aucune restriction.

---

## 2. Côté serveur : les variables d'environnement

Dans `.env.local` (Mac **et** VPS) :

```bash
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
# Facultatif : l'URI est déduite de APP_ORIGIN + /api/google/callback.
# GOOGLE_REDIRECT_URI=https://agenda.monumia.fr/api/google/callback
# Facultatifs (défauts) :
# GOOGLE_TIMEZONE=Europe/Paris
# GOOGLE_SYNC_INTERVAL_MIN=5
# GOOGLE_SYNC_PAST_DAYS=14
# GOOGLE_SYNC_FUTURE_DAYS=90
```

Puis **redémarre le serveur** (`npm run dev` en local, `pm2 reload agenda` sur
le VPS) : les variables d'environnement ne se rechargent pas à chaud. Les
réglages affichent l'URI de redirection exacte attendue tant que rien n'est
configuré — compare-la avec celle déclarée dans la console.

Deux nouveaux fichiers vivent dans `data/` (gitignorés, déjà ajoutés à
`sync-data.sh`) :

- `google-accounts.json` — comptes connectés **avec leurs refresh tokens** : à
  traiter comme `credentials.json` (jamais dans git, jamais partagé) ;
- `google-tombstones.json` — suppressions locales d'événements importés, en
  attente d'être rejouées côté Google.

---

## 3. Dans l'app

1. **Réglages → Google Calendar → Connecter un compte Google**. Consentement
   Google (écran « non validée » → Paramètres avancés → Accéder), retour aux
   réglages : le compte apparaît, un premier passage de synchro part tout
   seul quelques secondes plus tard.
2. Recommence pour chaque compte (Gmail perso, Delos…).
3. Par compte :
   - **Calendrier synchronisé** : le principal par défaut ; la liste se charge
     au clic.
   - **Agenda → Google** / **Google → Agenda** : les deux sens, débrayables.
   - **Contenu des copies** : *titre, lieu et notes réels* ou *bloc « occupé »
     privé* (les autres ne voient qu'un créneau pris, titre configurable).
     Une invitation garde toujours le vrai contenu.
   - **Catégories jamais copiées** : ex. `repas, trajet` si tu ne veux pas
     que ça apparaisse chez Delos.
   - **Calendrier professionnel** : coche-le sur le compte Delos, renseigne un
     mot (ex. `Delos`) : dans CE calendrier, tout événement dont le titre ne
     contient pas ce mot (casse et accents ignorés) est copié sous le titre
     **« Out of office »**, en bloc privé, sans lieu ni notes. Les événements
     qui le contiennent gardent leur copie normale, **en rouge** (couleur
     « Tomato » de Google, à la place du bleu du calendrier). Les comptes où la case n'est
     pas cochée ne changent pas. Marche sur n'importe quel calendrier ; mot
     vide = mode inactif.
   - **Catégorie des événements importés** : `travail` par défaut (`delos`
     pour le compte Delos si tu veux que le compteur d'heures les voie).
4. **Synchroniser maintenant** force un passage ; sinon toutes les 5 minutes,
   et ~2 s après chaque modification de l'agenda (modale, Josiane, plan du
   Conseil, drag & drop).

### Inviter quelqu'un

Dans la modale d'un événement, champ **Invités** (emails séparés par des
virgules). S'il y a plusieurs comptes, choisis celui qui envoie. À
l'enregistrement, la synchro crée la copie Google avec les invités et Google
envoie les mails ; les réponses apparaissent sous l'événement. Avec Josiane :
« Crée un point demain 14h avec alice@delos.fr et bob@delos.fr ».

### Une visio Google Meet

Coche **Visio Google Meet** dans la modale, ou demande-le à Josiane : « une
visio jeudi 14h avec Paul ». Le lien n'est pas fabriqué par l'agenda — il est
demandé à Google Calendar, qui crée une **vraie conférence** et la joint à
l'événement. Il part donc de lui-même dans le mail d'invitation que Google
envoie aux invités (bouton « Rejoindre avec Google Meet »), et s'affiche dans
la modale avec un bouton **Rejoindre**.

Josiane retrouve elle-même l'adresse mail des gens avec qui tu as **déjà** eu
une réunion : l'annuaire est déduit de l'agenda (invités des événements passés
et à venir, organisateurs des invitations reçues), il n'y a rien à saisir. Si
le nom est ambigu elle demande lequel, et si elle ne connaît personne sous ce
nom elle demande l'adresse — elle n'invente jamais un email ni un lien Meet.

Google crée la conférence de son côté, en une poignée de secondes : si le lien
n'est pas encore là au moment où Josiane répond, il apparaît au passage de
synchro suivant. Décocher la case retire la visio, côté Google aussi.

### Répondre à une invitation

L'événement importé s'affiche en pointillés + un compteur « N invitations »
dans l'en-tête tant que tu n'as pas répondu. Ouvre-le : *Accepté / Peut-être /
Refusé*. Refuser le retire de l'agenda (Google Agenda masque aussi les
événements refusés).

---

## 4. Comment ça marche (pour comprendre les cas limites)

- **Fenêtre glissante** : 14 jours en arrière, 90 en avant. Hors fenêtre, rien
  n'est touché (les vieux importés restent dans l'agenda comme historique).
- **Aucun état de synchro côté serveur.** Nos copies Google portent trois
  propriétés privées (`agendaId`, `agendaHash`, `agendaMeet`). À chaque passage : copie
  manquante → créée ; contenu changé → modifiée ; copie dont l'événement local
  a disparu → supprimée. Réécrire une semaine avec le Conseil supprime donc les
  anciennes copies et en crée de nouvelles, sans doublon.
- **Import** : tout événement du calendrier SANS ces marqueurs est importé.
  Ignorés : journée entière (l'agenda n'a pas de ligne « toute la journée »),
  refusés par toi, annulés, « lieu de travail » et anniversaires.
- **Modifié des deux côtés** entre deux passages → **Google gagne** (c'est le
  calendrier partagé qui fait foi), un avertissement apparaît dans les stats
  du compte. Modifié d'un seul côté → propagé normalement, y compris un
  déplacement local d'une réunion importée (Google applique la modification à
  ta copie ; si tu n'es pas l'organisateur, les autres ne bougent pas).
- **Supprimer une copie « Agenda » directement dans Google ne sert à rien** :
  elle revient au passage suivant. Supprime l'événement dans l'agenda.
- **Calendrier professionnel** : ce n'est PAS le type « Out of office » natif de
  Google (réservé au calendrier principal, immuable après création, sans invités
  ni visio) mais une copie ordinaire, simplement titrée « Out of office » et
  privée — comme le mode « occupé », avec ce titre-là. Un titre qui gagne ou
  perd le mot-clé, ou la case cochée/décochée, se traduit donc par un simple
  patch. Un PATCH Google laisse en place ce qu'il omet : l'agenda envoie
  explicitement description et lieu vides (et la visibilité « default » quand
  la copie redevient normale), sinon un ancien titre ou d'anciennes notes
  resteraient visibles.
- **Couleur** : la copie d'un événement Delos porte `colorId: 11` (Tomato) ; les
  « Out of office » gardent la couleur du calendrier. La couleur entre dans
  l'empreinte de la copie : cocher le mode repeint donc au passage suivant les
  copies Delos déjà poussées. Quitter le rouge (titre sans le mot-clé, mode
  décoché) envoie `colorId: null`, qui rend la couleur du calendrier — omettre
  le champ la laisserait en rouge. C'est la couleur de TA vue Google Calendar ;
  l'agenda lui-même ne change pas de couleur.
- **Invitations et visios** : un événement porté par CE compte avec des invités
  ou une visio garde son vrai contenu — les invités doivent recevoir un vrai
  titre, et la visio vit sur la copie du compte qui invite. Pour que ça
  n'expose pas une visio sans rapport avec Delos, le compte qui envoie par
  défaut (modale, Josiane) est d'abord un compte qui montre l'événement en
  clair : un calendrier professionnel dont le mot-clé n'est pas dans le titre
  passe après. Les copies miroir des autres comptes, elles, sont « Out of
  office » et sans visio.
- Les copies n'ont **pas de rappel Google** (les notifications viennent de
  l'agenda), sont marquées « occupé » et, en mode bloc, `private`.
- **Visio** : la conférence est portée par la copie du compte qui envoie
  l'invitation — les copies miroir des autres comptes n'en créent pas une
  deuxième. La demande n'est envoyée que tant que Google n'a pas rendu le
  lien ; la rejouer ne créerait de toute façon rien de neuf (`requestId`).
- **Quota** : un passage = une lecture par compte + une requête par changement.
  Très loin des limites Google (1 M requêtes/jour).
- **Déconnexion** : révoque le jeton, retire le compte et les événements
  importés depuis ce compte ; propose de supprimer aussi les copies « Agenda »
  du calendrier Google.

---

## 5. Dépannage

| Symptôme | Cause / remède |
|---|---|
| `redirect_uri_mismatch` sur l'écran Google | L'URI déclarée dans la console diffère de celle affichée dans les réglages (schéma, port, domaine, slash final). Corrige l'une ou l'autre. |
| « Accès bloqué : Agenda n'a pas terminé la procédure de validation » | App en statut *Testing* et compte absent des **utilisateurs test**. Ajoute-le, ou passe l'app en production (§ 1.2). |
| Le compte passe en **Reconnexion requise** après ~7 jours | App restée en *Testing* : refresh tokens expirés. Passe en production puis **Reconnecter**. Aussi : mot de passe Google changé, accès révoqué dans <https://myaccount.google.com/permissions>. |
| « Google n'a pas renvoyé de refresh token » | Le compte avait déjà autorisé l'app sans `prompt=consent`. Retire l'accès dans myaccount.google.com/permissions puis reconnecte. |
| `403 insufficientPermissions` | Portées changées depuis la connexion. Déconnecte puis reconnecte le compte. |
| « Cette application est bloquée » (compte Workspace) | Politique d'accès aux API de l'admin Workspace (§ 1.4). |
| Un événement importé revient après suppression | Il a été supprimé pendant que la synchro était en échec (compte en erreur) : la pierre tombale attend ; corrige l'erreur du compte, relance. |
| Rien ne se synchronise | `GOOGLE_CLIENT_ID`/`SECRET` absents (bandeau dans les réglages), serveur non redémarré après l'ajout, ou statut d'erreur affiché sur le compte (le message est celui de Google). Les logs serveur préfixent `[google-sync]`. |
