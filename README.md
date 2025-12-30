# PočasíMeteo Card

[![hacs_badge](https://img.shields.io/badge/HACS-Default-orange.svg)](https://github.com/hacs/integration)
[![GitHub release](https://img.shields.io/github/release/glaverCZ/pocasimeteo-card.svg)](https://github.com/glaverCZ/pocasimeteo-card/releases)

Pokročilá Lovelace custom card pro [PočasíMeteo integraci](https://github.com/glaverCZ/pocasimeteo).

## Funkce

- **Podpora více meteorologických modelů:** MASTER, ALADIN, ICONDE, ICONEU, YRno, GFS, WRF
- **Srovnání přesnosti modelů:** Automatický výběr nejpřesnějšího modelu na základě referenčních senzorů
- **Zobrazení rozdílů:** Porovnání předpovědi s aktuálními hodnotami
- **Pokročilé dlaždice:** Teplota, vlhkost, srážky, vítr, tlak a další
- **Vlastní pořadí:** Přizpůsobte si rozložení dlaždic podle preferencí
- **125+ PNG ikon počasí**

## Požadavky

- Home Assistant 2024.1.0 nebo novější
- [PočasíMeteo integrace](https://github.com/glaverCZ/pocasimeteo) musí být nainstalována a nakonfigurována

## Instalace

### HACS (doporučeno)

1. Otevřete HACS v Home Assistant
2. Přejděte do sekce **"Frontend"**
3. Klikněte na **+ EXPLORE & DOWNLOAD REPOSITORIES**
4. Vyhledejte **"PočasíMeteo Card"**
5. Klikněte na **Download**
6. **Restartujte Home Assistant**
7. **Smažte browser cache** (Ctrl+F5 nebo Cmd+Shift+R)

### Manuální instalace

1. Stáhněte `pocasimeteo-card.js` z [nejnovějšího release](https://github.com/glaverCZ/pocasimeteo-card/releases)
2. Zkopírujte soubor do `/config/www/` složky v Home Assistant
3. Přidejte resource v Home Assistant:
   - **Nastavení** → **Dashboardy** → **Resources** (tři tečky vpravo nahoře)
   - Klikněte na **+ PŘIDAT RESOURCE**
   - URL: `/local/pocasimeteo-card.js`
   - Typ zdroje: **JavaScript Module**
4. **Smažte browser cache** (Ctrl+F5 nebo Cmd+Shift+R)

## Použití

### Základní konfigurace

```yaml
type: custom:pocasimeteo-card
entity: weather.pocasimeteo_praha_6_ruzyne
models:
  - name: MASTER
    label: MASTER
  - name: ALADIN
    label: ALADIN
  - name: ICON
    label: ICONDE
  - name: COSMO
    label: ICONEU
  - name: YRno
    label: YRno
  - name: GFS
    label: GFS
  - name: WRF
    label: WRF
```

### Pokročilá konfigurace

```yaml
type: custom:pocasimeteo-card
entity: weather.pocasimeteo_praha_6_ruzyne
# Automatický výběr nejpřesnějšího modelu podle reference entity
best_match_temperature_entity: sensor.venku_teplota
# Zobrazení rozdílu oproti reference
temperature_entity: sensor.venku_teplota
humidity_entity: sensor.venku_vlhkost
wind_speed_entity: sensor.venku_vitr
# Vlastní pořadí dlaždic
tile_order:
  - temperature
  - humidity
  - precipitation
  - icon
  - wind
  - wind_gust
  - wind_direction
  - pressure
```

### Parametry

| Parametr | Typ | Popis | Výchozí |
|----------|-----|-------|---------|
| `entity` | string | **Povinné**. Entity ID primární weather entity (MASTER) | - |
| `models` | array | Seznam meteorologických modelů k zobrazení | Všechny modely |
| `best_match_temperature_entity` | string | Entity ID referenčního teplotního senzoru pro výběr nejpřesnějšího modelu | - |
| `temperature_entity` | string | Entity ID teplotního senzoru pro zobrazení rozdílu | - |
| `humidity_entity` | string | Entity ID vlhkostního senzoru pro zobrazení rozdílu | - |
| `wind_speed_entity` | string | Entity ID senzoru rychlosti větru pro zobrazení rozdílu | - |
| `tile_order` | array | Vlastní pořadí dlaždic | `[temperature, humidity, precipitation, icon, wind, wind_gust, wind_direction, pressure]` |

## Screenshot

![PočasíMeteo Card](https://raw.githubusercontent.com/glaverCZ/pocasimeteo-card/main/pocasimeteo-card-screenshot.png)

## Podpora

- [Vytvořte issue](https://github.com/glaverCZ/pocasimeteo-card/issues) pro nahlášení chyby nebo žádost o novou funkci
- [PočasíMeteo integrace](https://github.com/glaverCZ/pocasimeteo) - backend integrace

## Licence

Tento projekt je licencován pod MIT licencí - viz [LICENSE](LICENSE) soubor pro detaily.

## Upozornění

Tato card není oficiálně podporována ani schvalována provozovateli PočasíMeteo.cz.

---

**Vytvořeno pro Home Assistant komunitu**
