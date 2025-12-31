# Jak vyčistit HACS cache pro PočasíMeteo Card

## Krok 1: Hard Reload v prohlížeči
1. Otevřete Home Assistant
2. Stiskněte **Ctrl + Shift + Delete**
3. Vyberte "Cached images and files"
4. Časové období: "All time"
5. Klikněte Clear data
6. **Zavřete celý prohlížeč** (všechny okna)
7. Otevřete znovu a stiskněte Ctrl + F5

## Krok 2: Smazat HACS cache
V Home Assistant terminálu (nebo SSH):

```bash
# Zastavit Home Assistant
ha core stop

# Smazat HACS cache pro PočasíMeteo Card
rm -rf /config/www/community/pocasimeteo-card/

# Smazat browser cache
rm -rf /config/.storage/lovelace*

# Restart
ha core restart
```

## Krok 3: Reinstall s Force Redownload
1. HACS → Frontend
2. PočasíMeteo Card → ⋮ (tři tečky)
3. **Redownload** (ne jen Update)
4. Restart HA
5. Hard refresh (Ctrl + Shift + F5)

## Krok 4: Manuální instalace (pokud nic jiného nefunguje)
Stáhněte dist soubor přímo:
https://github.com/glaverCZ/pocasimeteo-card/releases/download/v2.2.3/pocasimeteo-card.js

Zkopírujte do:
`/config/www/community/pocasimeteo-card/pocasimeteo-card.js`
