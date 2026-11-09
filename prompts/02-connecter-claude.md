# 2. Créer la clé de connexion à Claude

**Ce que fait l'apprenant :** il crée, sur son propre ordinateur, la clé qui permettra à l'agent d'utiliser son abonnement Claude. On la colle dans l'outil plus tard, à l'étape 5, dans Réglages › Claude › « Connecter Claude » (l'outil rappelle alors ces 3 étapes), qui affiche « ✅ Claude est connecté ».

## À la main (1 minute)

Dans le terminal de son ordinateur :

```bash
claude setup-token
```

1. Le navigateur s'ouvre. On se connecte à son compte Claude (Pro ou Max) et on clique sur **Autoriser**.
2. La page affiche un code : on clique sur **Copier**, on revient dans le terminal, on colle (Cmd+V sur Mac, Ctrl+V sur PC) et on appuie sur Entrée.
3. Le terminal affiche la clé, qui commence par `sk-ant-oat01-…`. On la garde de côté, par exemple dans son gestionnaire de mots de passe : on ne la reverra plus.

**Ne jamais coller cette clé dans une discussion avec Claude.** Elle se colle uniquement dans la case « Connecter Claude » de l'outil.

**Ce qu'on voit à la fin :** une clé `sk-ant-oat01-…` mise de côté.

## Si ça ne marche pas

Décrivez à Claude ce que vous voyez (« J'ai collé le prompt 2, et je vois … au lieu de … ») : il corrige tout seul. L'outil n'existe pas encore à cette étape, il n'y a donc rien à restaurer.
