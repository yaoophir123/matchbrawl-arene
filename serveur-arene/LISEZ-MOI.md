# Serveur en ligne de l'Arène (Match Brawl 1.5)

Ce serveur relie les joueurs de l'Arène entre eux sur internet. Il ne fait tourner aucune partie : l'appareil qui crée la salle calcule le combat, le serveur transmet seulement les messages. Il n'a besoin d'aucune installation.

Le site reste sur Vercel ; ce serveur va sur **Render** (offre gratuite), car Vercel n'accepte pas les connexions permanentes (WebSocket) dont l'Arène a besoin.

## Mise en ligne (une seule fois, environ 10 minutes)

1. Sur **github.com**, crée un nouveau dépôt nommé `matchbrawl-arene`, puis dépose-y les trois fichiers de ce dossier : `serveur_arene.js`, `package.json` et `render.yaml` (bouton **Add file > Upload files**).
2. Sur **render.com**, crée un compte gratuit avec ton compte GitHub.
3. Clique sur **New +**, puis **Blueprint**, et choisis le dépôt `matchbrawl-arene`. Render lit `render.yaml` et prépare le service `matchbrawl-arene` (offre gratuite). Valide avec **Apply**.
4. Attends que le service passe à **Live**. Son adresse s'affiche, normalement `https://matchbrawl-arene.onrender.com`. Ouvre-la : tu dois lire « Serveur de l'Arène Match Brawl : en ligne ».

## Si l'adresse de Render est différente

Le jeu lit l'adresse du serveur dans le fichier `arene.json` de ton site. Ouvre ce fichier dans le dossier du site et remplace l'adresse, en gardant `wss://` au début et `/ws` à la fin :

```json
{ "serveur": "wss://TON-ADRESSE.onrender.com/ws" }
```

Republie ensuite le site avec `npx.cmd vercel --prod`. Inutile de republier l'application : elle lit ce fichier à chaque lancement.

## Le serveur gratuit s'endort

Avec l'offre gratuite de Render, le serveur se met en veille après une quinzaine de minutes sans joueur. Le premier joueur qui se connecte ensuite attend jusqu'à une minute ; le jeu affiche alors « Le serveur peut mettre jusqu'à une minute à se réveiller ».

Pour le garder éveillé, crée un compte gratuit sur **uptimerobot.com** et ajoute une surveillance de type HTTP(s) sur `https://TON-ADRESSE.onrender.com/sante`, toutes les 5 minutes. Vérifie les conditions actuelles de l'offre gratuite de Render (nombre d'heures par mois) ; l'offre payante la moins chère supprime la mise en veille.

## Le réseau local marche toujours

Sur un même Wi-Fi, sans internet, il suffit toujours de lancer `node serveur_arene.js` sur un ordinateur, avec le fichier `index.html` du jeu dans le même dossier, puis d'ouvrir l'adresse affichée sur chaque appareil.
