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

1. Stáhněte `pocasimeteo-card.js` a složku `icons/` z [nejnovějšího release](https://github.com/glaverCZ/pocasimeteo-card/releases)
2. Zkopírujte do `/config/www/` v Home Assistant
3. Přidejte resource:
   - **Nastavení** → **Dashboardy** → **Resources** (⋮ vpravo nahoře)
   - Klikněte na **➕ Add Resource**
   - URL: `/local/pocasimeteo-card.js`
   - Typ: **JavaScript Module**
4. **Smažte cache** (Ctrl+F5)

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

# Automatický výběr nejpřesnějšího modelu
best_match_temperature_entity: sensor.venku_teplota

# Zobrazení rozdílu oproti skutečné hodnotě
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

| Parametr | Typ | Popis |
|----------|-----|-------|
| `entity` | string | **Povinné**. Entity ID weather entity (s nebo bez názvu modelu) |
| `best_match_temperature_entity` | string | Entity ID teplotního senzoru pro automatický výběr nejlepšího modelu |
| `temperature_entity` | string | Entity ID teplotního senzoru pro zobrazení rozdílu |
| `humidity_entity` | string | Entity ID vlhkostního senzoru pro zobrazení rozdílu |
| `wind_speed_entity` | string | Entity ID senzoru rychlosti větru pro zobrazení rozdílu |
| `tile_order` | array | Vlastní pořadí dlaždic |
| `models` | array | Vlastní seznam modelů k zobrazení (volitelné) |

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

### Jak funguje automatický výběr modelu?

1. Nastavte `best_match_temperature_entity` na venkovní teplotní senzor
2. Card pravidelně porovnává předpověď všech modelů se skutečnou hodnotou
3. Automaticky vybírá model, který má **nejmenší chybu** za posledních 24 hodin
4. Model s nejlepší přesností je označen **zeleným rámečkem**

### Jak zobrazit rozdíly?

Nastavte referenční senzory (`temperature_entity`, `humidity_entity`, atd.). Card pak ve dlaždicích zobrazí:
- **Zelená hodnota** = předpověď odpovídá skutečnosti (rozdíl < 2°C)
- **Červená hodnota** = větší rozdíl (> 2°C)

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
