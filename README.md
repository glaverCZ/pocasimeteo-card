# 🎨 PočasíMeteo Card

[![hacs_badge](https://img.shields.io/badge/HACS-Default-orange.svg)](https://github.com/hacs/integration)
[![GitHub release](https://img.shields.io/github/release/glaverCZ/pocasimeteo-card.svg)](https://github.com/glaverCZ/pocasimeteo-card/releases)

Pokročilá Lovelace custom card pro zobrazení předpovědi počasí z [PočasíMeteo integrace](https://github.com/glaverCZ/pocasimeteo).

---

## ✨ Funkce

### 📊 Interaktivní grafy
- **Hodinový graf** s teplotou, srážkami a ikonami počasí
- **Optimalizovaná hustota** - každá 3. hodina pro 36h předpověď
- **PNG ikony přímo v tooltipu** při najetí myší

### 🔄 Podpora 7 meteorologických modelů
- **MASTER** (ensemble), **ALADIN**, **ICONDE**, **ICONEU**, **YRno**, **GFS**, **WRF**
- Přepínání mezi modely **jedním kliknutím**
- Automatické zobrazení všech dostupných modelů

### 🎯 Inteligentní výběr modelu
- **Automatický výběr nejpřesnějšího modelu** podle referenčních senzorů
- **Barevné označení přesnosti** (zelená = nejlepší, žlutá = dobrý, červená = horší)
- **Porovnání s aktuálními hodnotami** ve dlaždicích

### 🌈 Vizuální vylepšení
- **125+ barevných PNG ikon** počasí pro všechny podmínky
- **Vlastní rozložení** dlaždic podle preferencí
- **Dark/Light mode** - automatické přizpůsobení tématu

---

## 📋 Požadavky

- **Home Assistant** 2024.1.0 nebo novější
- **[PočasíMeteo integrace](https://github.com/glaverCZ/pocasimeteo)** musí být nainstalována

---

## 📦 Instalace

### Metoda 1: HACS (doporučeno)

1. Otevřete **HACS** v Home Assistant
2. Klikněte na **Frontend**
3. Klikněte na **⊕ Explore & Download Repositories**
4. Vyhledejte **"PočasíMeteo Card"**
5. Klikněte na **Download**
6. **Restartujte Home Assistant**
7. **Smažte cache prohlížeče** (Ctrl+F5 nebo Cmd+Shift+R)

### Metoda 2: Manuální instalace

1. Stáhněte `pocasimeteo-card.js` z [nejnovějšího release](https://github.com/glaverCZ/pocasimeteo-card/releases)
2. Zkopírujte do `/config/www/community/pocasimeteo-card/` v Home Assistant
3. Přidejte resource:
   - **Nastavení** → **Dashboardy** → **Resources** (⋮ vpravo nahoře)
   - Klikněte na **➕ Add Resource**
   - URL: `/hacsfiles/pocasimeteo-card/pocasimeteo-card.js`
   - Typ: **JavaScript Module**
4. **Restartujte Home Assistant**
5. **Smažte cache prohlížeče** (Ctrl+F5)

**Poznámka:** Všech 125 PNG ikon je embedded přímo v JS souboru (621 KB), není potřeba stahovat žádné další soubory.

---

## 🚀 Použití

### Základní konfigurace

```yaml
type: custom:pocasimeteo-card
entity: weather.pocasimeteo_praha_6_ruzyne
```

To je vše! Card automaticky najde všechny modely pro vybranou stanici.

### Pokročilá konfigurace

```yaml
type: custom:pocasimeteo-card
entity: weather.pocasimeteo_praha_6_ruzyne

# Automatický výběr nejpřesnějšího modelu a zobrazení rozdílu oproti skutečné hodnotě
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

### Výběr konkrétního modelu

```yaml
type: custom:pocasimeteo-card
entity: weather.pocasimeteo_praha_6_ruzyne_aladin
```

Card zobrazí všechny modely, ale ALADIN bude předvybrán.

---

## ⚙️ Parametry

### Základní parametry

| Parametr | Typ | Výchozí | Popis |
|----------|-----|---------|-------|
| `entity` | string | - | **Povinné**. Entity ID weather entity (s nebo bez názvu modelu) |
| `models` | array | Všech 7 | Vlastní seznam modelů k zobrazení |
| `tile_order` | array | Viz níže | Vlastní pořadí dlaždic |

### Reference entity (pro porovnání a auto-select)

| Parametr | Typ | Popis |
|----------|-----|-------|
| `temperature_entity` | string | Teplotní senzor pro automatický výběr nejlepšího modelu a zobrazení rozdílu v dlaždicích |
| `reference_humidity_entity` | string | Vlhkostní senzor pro výpočet skóre modelu |
| `reference_rainfall_entity` | string | Senzor srážek pro výpočet skóre modelu |
| `reference_wind_entity` | string | Senzor rychlosti větru pro výpočet skóre modelu |
| `reference_wind_gust_entity` | string | Senzor poryvů větru pro výpočet skóre modelu |
| `reference_pressure_entity` | string | Senzor tlaku pro výpočet skóre modelu |
| `reference_wind_direction_entity` | string | Senzor směru větru pro výpočet skóre modelu |

**Poznámka:** Pro zpětnou kompatibilitu je podporován i starý název `best_match_temperature_entity`, ale doporučujeme používat `temperature_entity`.

### Pokročilé nastavení

| Parametr | Typ | Výchozí | Popis |
|----------|-----|---------|-------|
| `model_accuracy_weights` | object | Viz příklad | Váhy pro výpočet skóre modelu (%) |
| `model_selection_hysteresis` | number | 30 | Počet minut, kdy se po manuálním výběru nevybírá automaticky |
| `show_current_weather` | boolean | true | Zobrazit aktuální počasí |
| `show_hourly_forecast` | boolean | true | Zobrazit hodinový graf |
| `show_daily_forecast` | boolean | true | Zobrazit denní předpověď |
| `hourly_hours` | number | 24 | Počet hodin pro hodinovou předpověď (1-72) |
| `scale` | number | 1.0 | Zvětšení celé card (0.8 = -20%, 1.2 = +20%) |
| `full_width` | boolean | false | Rozšířit card na plnou šířku |

#### Příklad model_accuracy_weights

```yaml
model_accuracy_weights:
  temperature: 30    # 30% váha teploty
  humidity: 20       # 20% váha vlhkosti
  precipitation: 20  # 20% váha srážek
  wind: 15           # 15% váha větru
  wind_gust: 10      # 10% váha poryvů
  pressure: 5        # 5% váha tlaku
```

### Dostupné dlaždice

- `temperature` - Teplota
- `humidity` - Vlhkost
- `precipitation` - Srážky
- `icon` - Ikona počasí
- `wind` - Rychlost větru
- `wind_gust` - Poryvy
- `wind_direction` - Směr větru
- `pressure` - Tlak

---

## 💡 Tipy

### Jak funguje automatický výběr modelu a zobrazení rozdílů?

1. Nastavte `temperature_entity` na venkovní teplotní senzor
2. Card **automaticky vybírá nejpřesnější model** - porovnává předpověď všech modelů se skutečnou hodnotou a vybírá ten s **nejmenší chybou** za posledních 24 hodin
3. Model s nejlepší přesností je označen **zeleným rámečkem**
4. Card také **zobrazuje rozdíly** mezi předpovědí a skutečnou hodnotou v dlaždicích:
   - **Zelená hodnota** = předpověď odpovídá skutečnosti (rozdíl < 2°C)
   - **Červená hodnota** = větší rozdíl (> 2°C)
5. Volitelně můžete přidat další reference entity (`reference_humidity_entity`, `reference_wind_entity`, atd.) pro komplexnější výpočet přesnosti modelů

### Lze změnit pořadí dlaždic?

Ano! Použijte `tile_order` pro vlastní rozložení.

---

## 📸 Screenshot

![PočasíMeteo Card](https://raw.githubusercontent.com/glaverCZ/pocasimeteo-card/main/pocasimeteo-card-screenshot.png)

---

## 🆘 Podpora

### Našli jste chybu nebo máte nápad?
- [📝 Vytvořte issue](https://github.com/glaverCZ/pocasimeteo-card/issues)
- [💻 Přispějte kódem](https://github.com/glaverCZ/pocasimeteo-card/pulls)

### Odkazy
- **Backend integrace:** [glaverCZ/pocasimeteo](https://github.com/glaverCZ/pocasimeteo)
- **PočasíMeteo.cz:** [www.pocasimeteo.cz](https://www.pocasimeteo.cz/)

---

## 📄 Licence

MIT License - viz [LICENSE](LICENSE) soubor.

## ⚠️ Upozornění

Tato card není oficiálně podporována provozovateli PočasíMeteo.cz. Jedná se o neoficiální komunitní projekt.

---

<div align="center">

**Vytvořeno pro českou Home Assistant komunitu** ❤️

</div>
