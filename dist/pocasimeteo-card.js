/*! PočasíMeteo Weather Card - HA 2024.1+ Compatible
 * Version: 2.0.0
 * Built: 2024-11-25
 */

(() => {
  class PocasimeteoCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._selectedEntityId = null;
      this._availableModels = [];
      this._currentEntity = null;
      this._userSelectedModel = false; // Флаг - uživatel ručně vybral model
      this._userModelSelectionTime = null; // Timestamp kdy uživatel naposledy ručně vybral model (pro hysterezis)
      this._timeUpdateInterval = null; // Interval pro aktualizaci času
      this._hourlyRefreshTimeout = null; // Timeout pro hodinový refresh předpovědi
      this._todayHoliday = '---'; // Cache pro svátek na dnes
      this._holidayFetchDate = null; // Datum posledního fetche pro cache invalidaci
      this._imageCache = {}; // Cache pro načtené obrázky ikon
      this._lastChartRender = null; // Timestamp posledního vykreslení grafu
      this._lastContentUpdate = null; // Timestamp poslední aktualizace obsahu (pro throttling)
      this._tooltipHideTimeout = null; // Timeout pro skrytí tooltipu s prodlevou
      this._timeUpdateTimeout = null; // Timeout pro aktualizaci času (odděleno od hourlyRefreshTimeout)
      this._userInitiatedUpdate = false; // Flag pro user-initiated model switches (bypass throttle)
      this._modelAccuracy = {}; // Cache pro přesnost modelů: {modelName: {average_error: 0.5, count: 10, tier: 'green'}}
      this._modelHistoryKey = 'pocasimeteo_model_accuracy'; // localStorage key pro historii přesnosti
      this._trendCache = {}; // Cache pro trendy z historie (aby se nefetchovalo stále)
      this._computedValuesCache = {}; // Cache pro počítané hodnoty (precipitation_value, wind_max, gust_max)
      this._displayedValuesCache = {}; // Cache pro zobrazené hodnoty aby se neobnovovaly zbytečně
      this._modelScores = {}; // Cache pro skóre modelů: {modelName: {score: 85, tier: 'green', breakdown: {...}}}
    }

    setConfig(config) {
      if (!config.entity) throw new Error('entity je povinná');
      this.config = config;
      this._selectedEntityId = config.entity;

      // Konfigurovaná seznam modelů k porovnání
      this._modelConfigs = config.models || [
        { name: 'MASTER', label: 'MASTER' },
        { name: 'ALADIN', label: 'ALADIN' },
        { name: 'ICON', label: 'ICONDE' },
        { name: 'COSMO', label: 'ICONEU' },
        { name: 'YRno', label: 'YRno' },
        { name: 'GFS', label: 'GFS' },
        { name: 'WRF', label: 'WRF' }
      ];

      // Reference entity pro detekci nejpřesnějšího modelu (rozšířené - více parametrů)
      this._bestMatchTemperatureEntity = config.best_match_temperature_entity || config.temperature_entity;
      this._temperatureEntity = config.temperature_entity;
      this._bestMatchModel = null; // Bude nastaven později

      // Nové reference entity pro rozšířený výpočet skóre modelu
      this._referenceHumidityEntity = config.reference_humidity_entity;
      this._referenceRainfallEntity = config.reference_rainfall_entity;
      this._referenceWindEntity = config.reference_wind_entity;
      this._referenceWindGustEntity = config.reference_wind_gust_entity;
      this._referencePressureEntity = config.reference_pressure_entity;
      this._referenceWindDirectionEntity = config.reference_wind_direction_entity;

      // Váhy pro výpočet skóre (default: 30% teplota, 20% ostatní)
      this._modelAccuracyWeights = config.model_accuracy_weights || {
        temperature: 30,
        humidity: 20,
        precipitation: 20,
        wind: 20,
        pressure: 10
      };

      // Hystereze pro manuální výběr - počet minut, kdy se automatický výběr vypne
      this._modelSelectionHysteresis = config.model_selection_hysteresis || 30; // minutes

      // Layout a zobrazení konfigurací
      this._showCurrentWeather = config.show_current_weather !== false; // Default: true
      this._showHourlyForecast = config.show_hourly_forecast !== false; // Default: true
      this._showDailyForecast = config.show_daily_forecast !== false; // Default: true
      this._fullWidth = config.full_width === true; // Default: false

      // Zvětšení všech položek (0.8 = -20%, 1.0 = 100%, 1.2 = +20%, atd.)
      this._scale = config.scale || 1.0; // Default: 1.0 (bez změny)

      // Počet hodin pro hodinovou předpověď (1-72, default: 24)
      this._hourlyHours = Math.min(Math.max(config.hourly_hours || 24, 1), 72);

      // Pořadí dlaždic (vč. ikony)
      // Pokud je tile_order zadán: zobrazit POUZE ty dlaždice v daném pořadí
      // Pokud NENÍ tile_order: výchozí layout se všemi dlaždicemi
      // Příklad: tile_order: ['temperature', 'humidity', 'icon']
      this._tileOrder = config.tile_order || [
        'icon',
        'temperature',
        'humidity',
        'precipitation',
        'pressure',
        'wind',
        'wind_gust',
        'wind_direction'
      ];

      console.log('[PočasíMeteo] setConfig - tile_order:', this._tileOrder);
    }

    set hass(hass) {
      this._hass = hass;

      // První render
      if (!this.shadowRoot.hasChildNodes()) {
        this._buildAvailableModels();
        this._autoSelectBestModel(); // Vybrat nejpřesnější model na začátku
        this._render();
        this._setupHourlyRefresh(); // Setup hourly refresh for forecast updates
        this._updateModelAccuracy(); // Load accuracy history for colors
      } else {
        // Při aktualizaci také zkontroluj nejpřesnější model
        this._autoSelectBestModel();
        this._updateModelAccuracy(); // Update accuracy periodically
      }

      this._updateContent();
    }

    _buildAvailableModels() {
      if (!this._hass || !this.config) return;

      const entity = this._hass.states[this.config.entity];
      if (!entity) return;

      // Zj isti stanici z entity_id (weather.pocasimeteo_STATION_MODEL)
      const entityId = this.config.entity;
      const models = [];

      // Extrahuj stanici z primární entity
      const match = entityId.match(/pocasimeteo_([a-z0-9_]+?)(?:_[a-z]+)?$/);
      if (!match) return;

      const station = match[1]; // praha_6_ruzyne nebo brno, atd.
      const prefix = `weather.pocasimeteo_${station}`;

      // Zkus najít entity pro každý model
      this._modelConfigs.forEach(modelConfig => {
        const modelLower = modelConfig.name.toLowerCase();
        let entityIdToCheck = prefix;

        // Primární entita (bez suffixu) je primární model
        if (modelConfig.name === 'MASTER') {
          entityIdToCheck = prefix;
        } else {
          entityIdToCheck = `${prefix}_${modelLower}`;
        }

        // Zkontroluj, zda entita existuje
        if (this._hass.states[entityIdToCheck]) {
          models.push({
            name: modelConfig.name,
            label: modelConfig.label,
            entityId: entityIdToCheck
          });
        }
      });

      this._availableModels = models;
      // Pokud se dostupné modely změnily a není vybraný model, zvol první
      if (models.length > 0 && !this._selectedEntityId) {
        this._selectedEntityId = models[0].entityId;
      }
    }

    _selectBestModel() {
      if (!this._bestMatchTemperatureEntity || !this._hass || !this._availableModels.length) {
        return;
      }

      const tempEntity = this._hass.states[this._bestMatchTemperatureEntity];
      if (!tempEntity) return;

      const refTemp = tempEntity.state;
      if (refTemp === undefined || refTemp === 'unknown') return;

      const referenceTemperature = parseFloat(refTemp);
      if (isNaN(referenceTemperature)) return;

      // Porovnej s aktuálními teplotami všech dostupných modelů
      let bestModel = null;
      let bestDiff = Infinity;

      this._availableModels.forEach(model => {
        const modelEntity = this._hass.states[model.entityId];
        if (!modelEntity) return;

        const modelTemp = modelEntity.attributes?.temperature;
        if (modelTemp === undefined) return;

        const diff = Math.abs(modelTemp - referenceTemperature);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestModel = model;
        }
      });

      this._bestMatchModel = bestModel; // Uložit nejpřesnější model pro CSS označení

      // Pokud je to první inicializace a uživatel vybral model, automaticky ho vyber
      if (bestModel && !this._userSelectedModel && bestModel.entityId !== this._selectedEntityId) {
        this._selectedEntityId = bestModel.entityId;
      }
    }

    _calculateModelScores() {
      /**
       * Vypočítá skóre přesnosti pro všechny modely na základě více parametrů
       * Vrací: { modelName: { score: 85, tier: 'green', breakdown: {...} }, ... }
       */
      if (!this._bestMatchTemperatureEntity || !this._hass || !this._availableModels.length) {
        return {};
      }

      const scores = {};
      const referenceValues = {};
      const modelValues = {}; // { paramName: [value1, value2, ...] }

      // 1. Sesbírám reference hodnoty z entit
      const refTemp = this._hass.states[this._bestMatchTemperatureEntity];
      if (!refTemp || refTemp.state === 'unknown') return {};
      referenceValues.temperature = parseFloat(refTemp.state);
      if (isNaN(referenceValues.temperature)) return {};

      // Ostatní parametry - volitelné
      if (this._referenceHumidityEntity) {
        const humidity = this._hass.states[this._referenceHumidityEntity];
        if (humidity && humidity.state !== 'unknown') {
          referenceValues.humidity = parseFloat(humidity.state);
        }
      }
      if (this._referenceRainfallEntity) {
        const rainfall = this._hass.states[this._referenceRainfallEntity];
        if (rainfall && rainfall.state !== 'unknown') {
          referenceValues.precipitation = parseFloat(rainfall.state);
        }
      }
      if (this._referenceWindEntity) {
        const wind = this._hass.states[this._referenceWindEntity];
        if (wind && wind.state !== 'unknown') {
          referenceValues.wind = parseFloat(wind.state);
        }
      }
      if (this._referenceWindGustEntity) {
        const gust = this._hass.states[this._referenceWindGustEntity];
        if (gust && gust.state !== 'unknown') {
          referenceValues.wind_gust = parseFloat(gust.state);
        }
      }
      if (this._referencePressureEntity) {
        const pressure = this._hass.states[this._referencePressureEntity];
        if (pressure && pressure.state !== 'unknown') {
          referenceValues.pressure = parseFloat(pressure.state);
        }
      }

      // 2. Sesbírám model hodnoty (z entity attributes)
      this._availableModels.forEach(model => {
        const modelEntity = this._hass.states[model.entityId];
        if (!modelEntity) return;

        const attrs = modelEntity.attributes || {};
        modelValues[model.name] = {
          temperature: parseFloat(attrs.temperature) || null,
          humidity: parseFloat(attrs.humidity) || null,
          precipitation: parseFloat(attrs.precipitation) || null,
          wind_speed: parseFloat(attrs.wind_speed) || null,
          wind_gust: parseFloat(attrs.wind_gust) || null,
          pressure: parseFloat(attrs.pressure) || null
        };
      });

      // 3. Vypočítám průměr a směrodatnou odchylku pro Z-score
      const stats = this._calculateZscoreStats(modelValues, referenceValues);

      // Normalizuj váhy na součet 100 (pro konzistentní skórování)
      const totalConfigWeight = Object.values(this._modelAccuracyWeights).reduce((a, b) => a + b, 0);
      const normalizedWeights = {};
      Object.keys(this._modelAccuracyWeights).forEach(key => {
        normalizedWeights[key] = (this._modelAccuracyWeights[key] / totalConfigWeight) * 100;
      });

      // 4. Vypočítám skóre pro každý model
      // Nejdřív spočítám maximální možné chyby pro normalizaci
      const maxErrors = {
        temperature: 15,  // °C - všechno nad 15°C chyby = 0 bodů
        humidity: 50,     // % - všechno nad 50% chyby = 0 bodů
        precipitation: 50, // mm
        wind: 20,         // m/s
        pressure: 50      // hPa
      };

      this._availableModels.forEach(model => {
        const modelData = modelValues[model.name];
        const breakdown = {};
        let weightedSum = 0;

        // Teplota (povinná)
        if (referenceValues.temperature !== undefined && modelData.temperature !== null) {
          const error = Math.abs(modelData.temperature - referenceValues.temperature);
          const accuracy = Math.max(0, 1 - (error / maxErrors.temperature)); // 0-1, kde 1 = perfektní
          breakdown.temperature = { error, accuracy: (accuracy * 100).toFixed(1) };
          weightedSum += normalizedWeights.temperature * accuracy;
        }

        // Vlhkost (volitelná)
        if (referenceValues.humidity !== undefined && modelData.humidity !== null) {
          const error = Math.abs(modelData.humidity - referenceValues.humidity);
          const accuracy = Math.max(0, 1 - (error / maxErrors.humidity));
          breakdown.humidity = { error, accuracy: (accuracy * 100).toFixed(1) };
          weightedSum += normalizedWeights.humidity * accuracy;
        }

        // Srážky (volitelné)
        if (referenceValues.precipitation !== undefined && modelData.precipitation !== null) {
          const error = Math.abs(modelData.precipitation - referenceValues.precipitation);
          const accuracy = Math.max(0, 1 - (error / maxErrors.precipitation));
          breakdown.precipitation = { error, accuracy: (accuracy * 100).toFixed(1) };
          weightedSum += normalizedWeights.precipitation * accuracy;
        }

        // Vítr (volitelné)
        if ((referenceValues.wind !== undefined || referenceValues.wind_gust !== undefined) && (modelData.wind_speed !== null || modelData.wind_gust !== null)) {
          let windScore = 0;
          let windWeight = 0;

          if (referenceValues.wind !== undefined && modelData.wind_speed !== null) {
            const error = Math.abs(modelData.wind_speed - referenceValues.wind);
            const accuracy = Math.max(0, 1 - (error / maxErrors.wind));
            breakdown.wind = { error, accuracy: (accuracy * 100).toFixed(1) };
            windScore += accuracy;
            windWeight += 1;
          }

          if (referenceValues.wind_gust !== undefined && modelData.wind_gust !== null) {
            const error = Math.abs(modelData.wind_gust - referenceValues.wind_gust);
            const accuracy = Math.max(0, 1 - (error / maxErrors.wind));
            breakdown.wind_gust = { error, accuracy: (accuracy * 100).toFixed(1) };
            windScore += accuracy;
            windWeight += 1;
          }

          if (windWeight > 0) {
            weightedSum += normalizedWeights.wind * (windScore / windWeight);
          }
        }

        // Tlak (volitelné)
        if (referenceValues.pressure !== undefined && modelData.pressure !== null) {
          const error = Math.abs(modelData.pressure - referenceValues.pressure);
          const accuracy = Math.max(0, 1 - (error / maxErrors.pressure));
          breakdown.pressure = { error, accuracy: (accuracy * 100).toFixed(1) };
          weightedSum += normalizedWeights.pressure * accuracy;
        }

        // Finální skóre (0-100%) - používáme normalizované váhy, takže vždy sčítáme na 100
        const score = Math.max(0, Math.min(100, weightedSum));

        // Debug log - podrobný rozpis
        console.log(`[PočasíMeteo] ${model.name}:`);
        console.log(`  breakdown:`, breakdown);
        console.log(`  weightedSum=${weightedSum.toFixed(2)}`);
        console.log(`  score=${score.toFixed(2)}, rounded=${Math.round(score)}`);

        // Určení barvy (tier)
        let tier = 'gray';
        if (score >= 80) tier = 'green';
        else if (score >= 60) tier = 'yellow';
        else tier = 'red';

        const roundedScore = Math.round(score);
        scores[model.name] = {
          score: roundedScore,
          tier,
          breakdown
        };
      });

      return scores;
    }

    _calculateZscore(value, reference, mean, stddev) {
      /**
       * Vypočítá Z-score chyby
       * Z-score = |value - reference - mean| / stddev
       * Měří, jak moc se chyba lišíí od průměrné chyby všech modelů
       */
      if (stddev === 0) return 0;
      const error = Math.abs(value - reference);
      return Math.abs(error - mean) / stddev;
    }

    _calculateZscoreStats(modelValues, referenceValues) {
      /**
       * Vypočítá průměr a stddev chyb pro každý parametr
       * Vrací: { temperature: { mean, stddev }, ... }
       */
      const stats = {};
      const paramNames = ['temperature', 'humidity', 'precipitation', 'wind_speed', 'wind_gust', 'pressure'];

      paramNames.forEach(param => {
        const refName = param === 'wind_speed' ? 'wind' : (param === 'wind_gust' ? 'wind_gust' : param);
        const refValue = referenceValues[refName];

        if (refValue === undefined) return; // Přeskočit, pokud nemáme referencí

        const errors = Object.values(modelValues)
          .map(m => Math.abs((m[param] || 0) - refValue))
          .filter(e => !isNaN(e));

        if (errors.length === 0) {
          stats[refName] = { mean: 0, stddev: 1 };
          return;
        }

        const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
        const variance = errors.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / errors.length;
        const stddev = Math.sqrt(variance);

        stats[refName] = { mean, stddev: stddev || 1 }; // stddev min 1 aby se nedelilo nulou
      });

      return stats;
    }

    _autoSelectBestModel() {
      console.log('[PočasíMeteo] _autoSelectBestModel() called');
      if (!this._hass || !this._availableModels.length) {
        console.log('[PočasíMeteo] Missing hass or available models, returning');
        return;
      }

      // Hysteresis check: Don't auto-select if user recently manually selected a model
      if (this._userModelSelectionTime) {
        const elapsedMinutes = (Date.now() - this._userModelSelectionTime) / 60000;
        if (elapsedMinutes < this._modelSelectionHysteresis) {
          // Still within hysteresis period, skip auto-select
          console.log('[PočasíMeteo] In hysteresis period, skipping auto-select');
          return;
        } else {
          // Hysteresis expired, clear the flag
          this._userSelectedModel = false;
          this._userModelSelectionTime = null;
          console.log('[PočasíMeteo] Hysteresis expired, resuming auto-select');
        }
      }

      // Vypočítej skóre pro všechny modely
      const scores = this._calculateModelScores();

      // Najdi model s nejvyšším skórem
      let bestModel = null;
      let bestScore = -1;

      console.log('[PočasíMeteo] Available models:', this._availableModels.map(m => ({ name: m.name, entityId: m.entityId })));
      console.log('[PočasíMeteo] Scores keys:', Object.keys(scores));
      console.log('[PočasíMeteo] Selecting best model from:', this._availableModels.map(m => m.name));

      this._availableModels.forEach(model => {
        const modelScore = scores[model.name]?.score;
        console.log(`[PočasíMeteo] Checking ${model.name}: score=${modelScore}, current best=${bestScore}`);
        if (scores[model.name] && scores[model.name].score > bestScore) {
          console.log(`[PočasíMeteo] → ${model.name} je nový best (${scores[model.name].score} > ${bestScore})`);
          bestScore = scores[model.name].score;
          bestModel = model;
        }
      });

      // Debug log
      console.log('[PočasíMeteo] Model scores:', scores);
      console.log('[PočasíMeteo] Final best model:', bestModel?.name, 'Score:', bestScore);

      // Uložit nejpřesnější model pro CSS označení
      this._bestMatchModel = bestModel;

      // Pokud jsme našli nejbližší model a není to aktuálně vybraný, vyber ho
      if (bestModel && bestModel.entityId !== this._selectedEntityId) {
        this._selectedEntityId = bestModel.entityId;

        // Aktualizuj aktivní tab
        const tabs = this.shadowRoot?.querySelectorAll('.model-tab');
        if (tabs) {
          tabs.forEach(tab => tab.classList.remove('active'));
        }

        // Najdi a označ aktivní tab
        if (this._availableModels.indexOf(bestModel) >= 0) {
          const tabIndex = this._availableModels.indexOf(bestModel);
          const tabs = this.shadowRoot?.querySelectorAll('.model-tab');
          if (tabs && tabs[tabIndex]) {
            tabs[tabIndex].classList.add('active');
          }
        }

        // Znovu načti obsah s novým modelem
        this._updateContentForSelectedModel();
        return true; // Signalizuj, že se model změnil
      }
      return false;
    }

    _render() {
      const style = document.createElement('style');
      style.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; }

        ha-card {
          overflow: visible;
          --ha-card-border-radius: 12px;
          height: 100%;
        }

        .card-container {
          background: var(--primary-background-color);
          color: var(--primary-text-color);
        }

        /* Full width styling */
        ha-card.full-width {
          width: 100%;
        }

        /* Hidden sections */
        .hidden {
          display: none;
        }

        /* Header - Model Selector */
        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          border-bottom: 1px solid var(--divider-color);
          background: linear-gradient(90deg, rgba(33, 150, 243, 0.05) 0%, rgba(33, 150, 243, 0) 100%);
          gap: 8px;
        }

        .card-header {
          display: none;
        }

        .card-title {
          display: none;
        }

        .model-tabs {
          display: flex;
          gap: 3px;
          flex-wrap: wrap;
          overflow-x: auto;
          justify-content: center;
          padding: 3px 8px;
          background: color-mix(in srgb, var(--primary-color, #2196f3) 5%, transparent);
        }

        .model-tabs::-webkit-scrollbar {
          height: 3px;
        }

        .model-tabs::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 2px;
        }

        .model-tab {
          padding: 4px 10px;
          background: rgba(255, 255, 255, 0.05);
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 500;
          transition: all 0.2s ease;
          color: var(--secondary-text-color);
          white-space: nowrap;
          flex-shrink: 0;
          line-height: 1;
        }

        .model-tab:hover {
          background: rgba(33, 150, 243, 0.15);
        }

        .model-tab.active {
          background: var(--primary-color);
          color: white;
        }

        .model-tab.best-match {
          border: 2px solid #4caf50;
          box-shadow: 0 0 8px rgba(76, 175, 80, 0.4);
          background: rgba(76, 175, 80, 0.05);
        }

        .model-tab.best-match:hover {
          background: rgba(76, 175, 80, 0.15);
          box-shadow: 0 0 12px rgba(76, 175, 80, 0.6);
        }

        .model-tab.best-match.active {
          background: var(--primary-color);
          color: white;
          border: 2px solid #4caf50;
          box-shadow: 0 0 8px rgba(76, 175, 80, 0.4);
        }

        /* Model accuracy color coding */
        .model-tab.model-green {
          border-left: 3px solid #4caf50;
        }

        .model-tab.model-green:hover {
          background: rgba(76, 175, 80, 0.1);
        }

        .model-tab.model-green.active {
          background: #4caf50;
          border-left-color: #4caf50;
        }

        .model-tab.model-yellow {
          border-left: 3px solid #ffb74d;
        }

        .model-tab.model-yellow:hover {
          background: rgba(255, 183, 77, 0.1);
        }

        .model-tab.model-yellow.active {
          background: #ffb74d;
          border-left-color: #ffb74d;
          color: #333;
        }

        .model-tab.model-red {
          border-left: 3px solid #ef5350;
        }

        .model-tab.model-red:hover {
          background: rgba(239, 83, 80, 0.1);
        }

        .model-tab.model-red.active {
          background: #ef5350;
          border-left-color: #ef5350;
        }

        .model-precision {
          font-size: 8px;
          opacity: 0.6;
          margin-top: 0;
        }

        /* Stale warning */
        .stale-warning {
          background: #fff3cd;
          color: #856404;
          padding: 12px 16px;
          text-align: center;
          font-weight: 500;
          font-size: 13px;
          border-bottom: 1px solid rgba(133, 100, 4, 0.2);
        }

        /* Current Weather - Invisible Table Layout */
        .current-section {
          padding: 12px 16px;
          margin-bottom: 0;
          border-bottom: none;
          background: color-mix(in srgb, var(--primary-color, #2196f3) 5%, transparent);
        }

        /* 2x4 Layout: [Icon+Temp] [Row1: Humidity, Precip, Pressure] [Row2: Wind, Gust, Direction] */
        .current-weather {
          display: grid;
          grid-template-columns: 1.2fr 1fr 1fr 1fr;
          grid-template-rows: auto auto;
          gap: 8px;
          padding: 8px 0;
          align-items: stretch;
        }

        /* Weather icon cell - independent grid cell for reordering */
        .weather-icon-cell {
          display: grid;
          align-items: center;
          justify-items: center;
          padding: 6px 4px;
          border-radius: var(--ha-card-border-radius, 4px);
          background: color-mix(in srgb, var(--primary-color, #2196f3) 5%, transparent);
          height: 120px;
        }

        .weather-icon {
          font-size: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: auto;
          height: auto;
        }

        .weather-icon img {
          width: 48px;
          height: 48px;
          object-fit: contain;
          filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.1));
        }

        .weather-item {
          display: grid;
          grid-template-columns: 1fr;
          grid-template-rows: auto auto auto auto auto;
          align-items: center;
          justify-items: center;
          padding: 6px 4px;
          border-radius: var(--ha-card-border-radius, 4px);
          background: var(--ha-card-background, #fff);
          background: color-mix(in srgb, var(--primary-color, #2196f3) 5%, transparent);
          height: 120px;
          text-align: center;
          gap: 2px;
        }

        .weather-item-label {
          font-size: 11px;
          opacity: 0.6;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          grid-row: 1;
          align-self: flex-start;
          font-weight: 400;
        }

        /* Reference value */
        .weather-item-reference {
          font-size: 11px;
          font-weight: 500;
          opacity: 0.9;
          grid-row: 2;
          line-height: 1.2;
        }

        .weather-item-trend {
          display: inline;
          font-size: 11px;
          margin-left: 2px;
        }

        /* Dividing line */
        .weather-item-divider {
          width: 70%;
          height: 1px;
          background: var(--divider-color, rgba(0, 0, 0, 0.12));
          grid-row: 3;
          align-self: start;
          margin: 0 0 2px 0;
          display: none;  /* Hidden by default, shown only when reference exists */
        }

        /* Forecast value */
        .weather-item-forecast {
          font-size: 13px;
          font-weight: 600;
          line-height: 1.2;
          grid-row: 4;
          color: var(--primary-text-color);
        }

        /* Precipitation specific styles - smooth updates */
        .precipitation-value,
        .precipitation-diff {
          transition: opacity 0.15s ease-in-out;
        }

        /* Unit */
        .weather-item-unit {
          font-size: 10px;
          opacity: 0.7;
          grid-row: 5;
          align-self: flex-end;
          font-weight: 500;
        }

        /* Temperature cell - same styling as other weather items */
        .temperature-cell {
          display: grid;
          grid-template-columns: 1fr;
          grid-template-rows: auto auto auto auto auto;
          align-items: center;
          justify-items: center;
          padding: 6px 4px;
          border-radius: var(--ha-card-border-radius, 4px);
          background: color-mix(in srgb, var(--primary-color, #2196f3) 5%, transparent);
          height: 120px;
          text-align: center;
          gap: 2px;
        }

        .temperature-cell .weather-item-forecast {
          font-size: 18px;
          font-weight: 700;
        }

        .weather-left {
          display: none;
        }

        .weather-right {
          display: none;
        }

        .temperature {
          font-size: 38px;
          font-weight: 300;
          line-height: 1;
          margin-bottom: 2px;
        }

        .condition {
          font-size: 13px;
          opacity: 0.8;
          margin-bottom: 1px;
          display: none;
        }

        .data-age {
          font-size: 11px;
          opacity: 0.6;
        }

        .temp-label {
          font-size: 10px;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .temp-value {
          font-size: 18px;
          font-weight: 600;
          line-height: 1.2;
        }

        .humidity {
          font-size: 12px;
          margin-top: 4px;
        }

        .big-time {
          font-size: 24px;
          font-weight: 700;
          line-height: 1;
        }

        .small-date {
          font-size: 11px;
          opacity: 0.9;
        }

        .data-line {
          font-size: 12px;
          opacity: 0.95;
        }

        /* Details Grid */
        .details-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1px;
          background: var(--divider-color);
          margin: 0;
        }

        .detail-item {
          background: var(--primary-background-color);
          padding: 4px 8px;
          text-align: center;
        }

        .detail-label {
          font-size: 9px;
          opacity: 0.6;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 2px;
        }

        .detail-value {
          font-size: 15px;
          font-weight: 500;
        }

        /* Forecast Sections */
        .forecast-section {
          padding: 8px 12px;
          margin: 0;
          background: color-mix(in srgb, var(--primary-color, #2196f3) 5%, transparent);
        }

        .forecast-title {
          font-weight: 600;
          font-size: 12px;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          opacity: 0.8;
        }

        /* Hourly Forecast */
        .hourly-forecast {
          position: relative;
          width: 100%;
          height: 180px;
          padding: 0;
          margin: 0;
          background: transparent;
          border: none;
          border-radius: 0;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
        }

        .hourly-forecast canvas {
          width: 100%;
          flex: 1;
          display: block;
        }

        .hourly-forecast-tooltip {
          position: absolute;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 4px;
          padding: 6px 8px;
          font-size: 9px;
          color: rgba(255, 255, 255, 0.95);
          pointer-events: none;
          z-index: 1000;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          display: none;
          line-height: 1.2;
          backdrop-filter: blur(10px);
          text-align: center;
          width: auto;
          max-width: 100px;
        }

        .forecast-item {
          flex-shrink: 0;
          min-width: 56px;
          padding: 7px;
          background: var(--secondary-background-color);
          border-radius: 5px;
          text-align: center;
          font-size: 11px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .forecast-item-time {
          font-weight: 500;
          font-size: 10px;
          opacity: 0.8;
        }

        .forecast-item-icon {
          font-size: 32px;
          flex-shrink: 0;
        }

        .forecast-item-icon img {
          width: 32px;
          height: 32px;
          object-fit: contain;
        }

        .forecast-item-temp {
          font-weight: 600;
          font-size: 12px;
        }

        .forecast-item-wind {
          font-size: 10px;
          opacity: 0.8;
        }

        .forecast-item-rain {
          font-size: 10px;
          opacity: 0.8;
          color: rgba(33, 150, 243, 0.8);
        }

        /* Daily Forecast */
        .daily-forecast {
          display: flex;
          flex-direction: row;
          gap: 4px;
          overflow-x: visible;
          overflow-y: hidden;
          padding-bottom: 6px;
          margin: 0;
          padding: 0;
          scroll-behavior: smooth;
          flex-wrap: wrap;
          justify-content: flex-start;
        }

        .daily-forecast::-webkit-scrollbar {
          height: 8px;
        }

        .daily-forecast::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.08);
          border-radius: 4px;
          margin: 0 16px;
        }

        .daily-forecast::-webkit-scrollbar-thumb {
          background: rgba(33, 150, 243, 0.4);
          border-radius: 4px;
        }

        .daily-forecast::-webkit-scrollbar-thumb:hover {
          background: rgba(33, 150, 243, 0.7);
        }

        .daily-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 5px 3px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 3px;
          font-size: 9px;
          min-width: 50px;
          flex: 1 1 calc(14.28% - 4px);
          max-width: 85px;
          text-align: center;
        }

        .daily-day {
          font-weight: 600;
          font-size: 10px;
          line-height: 1;
        }

        .daily-icon {
          font-size: 24px;
        }

        .daily-icon img {
          width: 24px;
          height: 24px;
          object-fit: contain;
        }

        .daily-temps {
          text-align: center;
          font-weight: 600;
          font-size: 11px;
          line-height: 1;
        }

        .daily-temp-max {
          color: var(--primary-color);
        }

        .daily-temp-min {
          opacity: 0.6;
          font-size: 9px;
        }

        .daily-wind {
          font-size: 9px;
          opacity: 0.8;
        }

        .daily-rain {
          font-size: 8px;
          color: rgba(33, 150, 243, 0.8);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rain-icon {
          display: inline-block;
          margin-right: 2px;
        }
      `;

      const card = document.createElement('ha-card');
      if (this._fullWidth) {
        card.classList.add('full-width');
      }

      const content = document.createElement('div');
      content.className = 'card-container';

      // Model tabs - budou přidány na konec, ne do headeru
      const tabs = document.createElement('div');
      tabs.className = 'model-tabs';
      tabs.id = 'modelTabs';

      // Stale warning
      const warning = document.createElement('div');
      warning.id = 'staleWarning';
      warning.className = 'stale-warning';
      warning.style.display = 'none';
      warning.textContent = '⚠️ Data jsou zastaralá (>90 minut)';
      content.appendChild(warning);

      // Current weather with compact layout
      const current = document.createElement('div');
      current.className = 'current-section' + (this._showCurrentWeather ? '' : ' hidden');
      current.innerHTML = `
        <!-- Horní řádek: čas+datum+svátek | popis počasí | východ+západ -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 16px;">
          <div style="display: flex; gap: 4px; flex-direction: column; flex: 0 0 auto;">
            <div id="currentTime" style="font-size: 20px; font-weight: 700; line-height: 1;">--:--</div>
            <div id="currentDate" style="font-size: 11px; opacity: 0.75; line-height: 1.2;">--</div>
            <div id="todayHoliday" style="font-size: 10px; opacity: 0.65; line-height: 1.2;">---</div>
          </div>
          <div style="flex: 1; text-align: center; font-size: 12px; font-weight: 500;">
            <div id="weatherDescription" style="letter-spacing: 0.3px;">--</div>
          </div>
          <div style="display: flex; gap: 8px; font-size: 11px; flex: 0 0 auto;">
            <div style="text-align: right;">
              <div style="opacity: 0.65; font-size: 9px;">Východ</div>
              <div id="sunrise" style="font-weight: 600;">--:--</div>
            </div>
            <div style="text-align: right;">
              <div style="opacity: 0.65; font-size: 9px;">Západ</div>
              <div id="sunset" style="font-weight: 600;">--:--</div>
            </div>
          </div>
        </div>

        <!-- 2x4 Layout: [Icon+Temp (col1)] [Row1: Humidity, Precipitation, Pressure] [Row2: Wind, Gust, Direction] -->
        <div class="current-weather">
          <!-- Icon - now independent grid cell for reordering -->
          <div class="weather-icon-cell" id="iconCell">
            <div class="weather-icon" id="icon">🌡️</div>
          </div>

          <!-- Temperature -->
          <div class="weather-item temperature-cell" id="temperatureCell">
            <div class="weather-item-label">Teplota</div>
            <div class="weather-item-reference" id="temperatureRef"></div>
            <div class="weather-item-divider"></div>
            <div class="weather-item-forecast" id="temperatureForecast">--</div>
            <div class="weather-item-unit" id="temperatureUnit">°C</div>
          </div>

          <!-- Row 1: Vlhkost, Srážky, Tlak -->
          <div class="weather-item" id="humidityCell">
            <div class="weather-item-label">Vlhkost</div>
            <div class="weather-item-reference" id="humidityRef"></div>
            <div class="weather-item-divider"></div>
            <div class="weather-item-forecast" id="humidityForecast">--</div>
            <div class="weather-item-unit" id="humidityUnit">%</div>
          </div>
          <div class="weather-item" id="precipitationCell">
            <div class="weather-item-label">Srážky</div>
            <div class="weather-item-reference" id="precipitationRef"></div>
            <div class="weather-item-divider"></div>
            <div class="weather-item-forecast" id="precipitationForecast">0</div>
            <div class="weather-item-unit" id="precipitationUnit">mm</div>
          </div>
          <div class="weather-item" id="pressureCell">
            <div class="weather-item-label">Tlak</div>
            <div class="weather-item-reference" id="pressureRef"></div>
            <div class="weather-item-divider"></div>
            <div class="weather-item-forecast" id="pressureForecast">--</div>
            <div class="weather-item-unit" id="pressureUnit">hPa</div>
          </div>

          <!-- Row 2: Vítr, Nárazy, Směr -->
          <div class="weather-item" id="windCell">
            <div class="weather-item-label">Vítr</div>
            <div class="weather-item-reference" id="windRef"></div>
            <div class="weather-item-divider"></div>
            <div class="weather-item-forecast" id="windForecast">--</div>
            <div class="weather-item-unit" id="windUnit">m/s</div>
          </div>
          <div class="weather-item" id="windGustCell">
            <div class="weather-item-label">Nárazy</div>
            <div class="weather-item-reference" id="windGustRef"></div>
            <div class="weather-item-divider"></div>
            <div class="weather-item-forecast" id="windGustForecast">--</div>
            <div class="weather-item-unit" id="windGustUnit">m/s</div>
          </div>
          <div class="weather-item" id="windDirectionCell">
            <div class="weather-item-label">Směr</div>
            <div class="weather-item-reference" id="windDirectionRef"></div>
            <div class="weather-item-divider"></div>
            <div class="weather-item-forecast" id="windDirectionForecast">--</div>
            <div class="weather-item-unit" id="windDirectionUnit"></div>
          </div>
        </div>
        <div class="condition" id="cond">--</div>
      `;
      content.appendChild(current);

      // Model tabs mezi aktuálním stavem a předpověďmi
      content.appendChild(tabs);

      // Hourly forecast
      const hourlySection = document.createElement('div');
      hourlySection.className = 'forecast-section' + (this._showHourlyForecast ? '' : ' hidden');
      hourlySection.innerHTML = `
        <div class="hourly-forecast" id="hourly"></div>
      `;
      content.appendChild(hourlySection);

      // Daily forecast
      const dailySection = document.createElement('div');
      dailySection.className = 'forecast-section' + (this._showDailyForecast ? '' : ' hidden');
      dailySection.innerHTML = `
        <div class="daily-forecast" id="daily"></div>
      `;
      content.appendChild(dailySection);

      card.appendChild(style);
      card.appendChild(content);

      // Aplikuj scaling pokud je nastavený
      if (this._scale !== 1.0) {
        card.style.transform = `scale(${this._scale})`;
        card.style.transformOrigin = 'top left';
        card.style.width = `${100 / this._scale}%`;
      }

      this.shadowRoot.appendChild(card);

      // Calculate model scores for UI display
      this._modelScores = this._calculateModelScores();

      // Setup model tabs
      this._setupModelTabs();

      // Setup time update interval (every 30 seconds)
      this._startTimeUpdate();
    }

    _startTimeUpdate() {
      // Pokud je interval už běží, nepřepisuj ho znovu
      if (this._timeUpdateInterval) {
        console.log('[PočasíMeteo] Time update already scheduled, skipping');
        this._updateSystemTime(); // Ale aktualizuj čas hned
        return;
      }

      // Update time immediately
      this._updateSystemTime();

      // Schedule next update synchronously at the start of the next minute
      const now = new Date();
      const secondsUntilNextMinute = (60 - now.getSeconds()) * 1000;
      console.log(`[PočasíMeteo] Time update scheduled in ${Math.round(secondsUntilNextMinute / 1000)}s`);

      // Clear any existing time update timeout first
      if (this._timeUpdateTimeout) {
        clearTimeout(this._timeUpdateTimeout);
      }

      this._timeUpdateTimeout = setTimeout(() => {
        console.log('[PočasíMeteo] Triggering time update at minute start');
        this._updateSystemTime();
        // Then update every minute
        if (this._timeUpdateInterval) {
          clearInterval(this._timeUpdateInterval);
        }
        this._timeUpdateInterval = setInterval(() => {
          console.log('[PočasíMeteo] Updating time (interval)');
          this._updateSystemTime();
        }, 60000);
      }, secondsUntilNextMinute);
    }

    _setupHourlyRefresh() {
      // Clear any existing timeout
      if (this._hourlyRefreshTimeout) {
        clearTimeout(this._hourlyRefreshTimeout);
      }

      // Calculate time until next whole hour + random 1-2 minute offset
      const now = new Date();
      const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0);
      const minuteOffset = Math.floor(Math.random() * 2) + 1; // 1-2 minutes
      nextHour.setMinutes(minuteOffset);

      const msUntilRefresh = nextHour.getTime() - now.getTime();

      // Schedule the refresh
      this._hourlyRefreshTimeout = setTimeout(() => {
        // Refresh the hourly forecast content
        this._updateContentForSelectedModel();

        // Recursively setup next refresh
        this._setupHourlyRefresh();
      }, msUntilRefresh);
    }

    _updateSystemTime() {
      const now = new Date();
      const sr = this.shadowRoot;

      // Format time as HH:MM
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;

      // Format date as "Pondělí 19.11" (Czech day name + day.month)
      const czechDayNames = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
      const dayName = czechDayNames[now.getDay()];
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const dateStr = `${dayName} ${day}.${month}`;

      // Update time and date elements (if they exist from old layout)
      const timeEl = sr.querySelector('#currentTime');
      if (timeEl) {
        timeEl.textContent = timeStr;
      }

      const dateEl = sr.querySelector('#currentDate');
      if (dateEl) {
        dateEl.textContent = dateStr;
      }

      // Load and update today's holiday
      const holidayEl = sr.querySelector('#todayHoliday');
      if (holidayEl) {
        this._loadTodayHoliday().then(holiday => {
          holidayEl.textContent = holiday;
        });
      }
    }

    disconnectedCallback() {
      // Clean up intervals/timeouts when card is removed
      if (this._timeUpdateInterval) {
        clearInterval(this._timeUpdateInterval);
      }
      if (this._timeUpdateTimeout) {
        clearTimeout(this._timeUpdateTimeout);
      }
      if (this._tooltipHideTimeout) {
        clearTimeout(this._tooltipHideTimeout);
      }
      if (this._hourlyRefreshTimeout) {
        clearTimeout(this._hourlyRefreshTimeout);
      }
    }

    _setupModelTabs() {
      const tabsContainer = this.shadowRoot.querySelector('#modelTabs');
      if (!tabsContainer || !this._availableModels.length) return;

      // Clear existing tabs
      tabsContainer.innerHTML = '';

      this._availableModels.forEach(model => {
        const tab = document.createElement('div');
        tab.className = 'model-tab';
        if (this._selectedEntityId === model.entityId) {
          tab.classList.add('active');
        }
        // Přidej CSS třídu best-match pro nejpřesnější model
        if (this._bestMatchModel && this._bestMatchModel.entityId === model.entityId) {
          tab.classList.add('best-match');
        }

        // Apply accuracy color class
        const accuracy = this._getModelAccuracyDisplay(model.name);
        if (accuracy.tier && accuracy.tier !== 'gray') {
          tab.classList.add(`model-${accuracy.tier}`);
        }

        const precisionHtml = accuracy.score ?
          `<div class="model-precision" id="precision-${model.name}" title="${accuracy.tooltip}">${accuracy.score}</div>` :
          '';

        tab.innerHTML = `
          <div>${model.label}</div>
          ${precisionHtml}
        `;

        tab.addEventListener('click', () => {
          this._selectedEntityId = model.entityId;
          this._userSelectedModel = true; // Uživatel ručně vybral model
          this._userModelSelectionTime = Date.now(); // Zaznamenat čas pro hysterezis
          this._userInitiatedUpdate = true; // Mark as user-initiated to bypass throttle

          // Update active tab
          this.shadowRoot.querySelectorAll('.model-tab').forEach(t => {
            t.classList.remove('active');
          });
          tab.classList.add('active');

          this._updateContent();

          // Reset flag after update
          setTimeout(() => {
            this._userInitiatedUpdate = false;
          }, 100);
        });

        tabsContainer.appendChild(tab);
      });
    }

    _updateContent() {
      if (!this._hass || !this._selectedEntityId) return;

      // Smart throttle: Skip throttle for user-initiated updates (model clicks)
      // but keep throttle for automatic Home Assistant state changes
      const now = Date.now();
      if (!this._userInitiatedUpdate && this._lastContentUpdate && (now - this._lastContentUpdate) < 1000) {
        // Automatic update too soon, skip
        return;
      }
      this._lastContentUpdate = now;

      // Smart refresh: Pokud jsou data starší než 2 minuty, refresh hned (ne čekej na scheduler)
      const entity = this._hass.states[this._selectedEntityId];
      if (entity && entity.attributes) {
        const dataAgeMins = entity.attributes.data_age_minutes;
        if (dataAgeMins !== undefined && dataAgeMins > 2) {
          console.log(`Data are ${dataAgeMins} minutes old, requesting refresh...`);
          // Skryj první item v hodinové předpovědi (z minulé hodiny)
          const sr = this.shadowRoot;
          const hourlyContainer = sr.querySelector('#hourly');
          if (hourlyContainer && hourlyContainer.firstChild) {
            hourlyContainer.firstChild.style.display = 'none';
          }
          this._requestRefresh();
          return; // Počkej na refresh, pak se znovu zavolá _updateContent()
        }
      }

      // Pokud je nastavena temperature_entity a uživatel nezvolil model ručně,
      // zkus najít nejbližší model
      if (this._temperatureEntity && this._availableModels.length > 0 && !this._userSelectedModel) {
        const modelChanged = this._autoSelectBestModel();
        if (modelChanged) return; // _autoSelectBestModel() se o update postará
      }

      // Když se aktualizují data, zobraz zpátky první item
      const hourlyContainer = this.shadowRoot.querySelector('#hourly');
      if (hourlyContainer && hourlyContainer.firstChild) {
        hourlyContainer.firstChild.style.display = '';
      }

      this._updateContentForSelectedModel();
    }

    _getCurrentHourForecast(forecastHourly) {
      // Vrátí forecast data pro aktuální hodinu
      if (!forecastHourly || !Array.isArray(forecastHourly)) return null;

      const now = new Date();
      const currentHour = now.getHours();

      // Najdi první forecast item který je v aktuální hodině
      for (const item of forecastHourly) {
        const dt = new Date(item.datetime || item.forecast_time);
        if (dt.getHours() === currentHour) {
          return item;
        }
      }

      return null;
    }

    _getWeatherDescription(cloudiness, precipitation) {
      // Generuj textový popis počasí na základě O (oblačnost) a S (srážky)
      let conditions = '';

      const cloudPercent = parseInt(cloudiness);
      const precipMm = parseFloat(precipitation);

      if (cloudPercent <= 10) {
        conditions = 'Jasno';
      } else if (cloudPercent <= 30) {
        conditions = 'Skoro jasno';
      } else if (cloudPercent <= 70) {
        conditions = 'Polojasno';
      } else if (cloudPercent <= 90) {
        conditions = 'Oblačno';
      } else {
        conditions = 'Zataženo';
      }

      if (precipMm > 0) {
        if (precipMm < 0.5) {
          conditions += ', slabý déšť';
        } else if (precipMm < 2) {
          conditions += ', déšť';
        } else {
          conditions += ', silný déšť';
        }
      }

      return conditions;
    }

    _requestRefresh() {
      // Zavolej Home Assistant API k refreshu entity
      if (!this._hass || !this._selectedEntityId) return;

      console.log(`[PočasíMeteo] Requesting refresh for ${this._selectedEntityId}`);

      // Call the refresh service
      this._hass.callService('homeassistant', 'update_entity', {
        entity_id: this._selectedEntityId
      }).then(() => {
        console.log('[PočasíMeteo] Refresh service called successfully');
      }).catch((error) => {
        console.error('[PočasíMeteo] Refresh service error:', error);
      });
    }

    async _updateContentForSelectedModel() {
      if (!this._hass || !this._selectedEntityId) return;

      const entity = this._hass.states[this._selectedEntityId];
      if (!entity) return;

      const a = entity.attributes || {};
      const sr = this.shadowRoot;

      // Current weather
      sr.querySelector('#cond').textContent = a.condition || '--';

      // Get current hour forecast data
      const currentHourData = this._getCurrentHourForecast(a.forecast_hourly) || {};

      // Cache pro trendy - aby se neopakovaně načítaly
      if (!this._trendCache) {
        this._trendCache = {};
      }

      // Helper to get trend from entity history (poslední hodinu) - s caching
      const getTrendFromHistory = async (entityId) => {
        if (!entityId || !this._hass) return '';

        // Vrátit z cache pokud existuje a není starší než 5 minut
        const cacheKey = `trend_${entityId}`;
        const cached = this._trendCache[cacheKey];
        if (cached && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
          return cached.value;
        }

        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        try {
          // Volej Home Assistant history API
          const history = await this._hass.callApi(
            'get',
            `history/period/${oneHourAgo.toISOString()}?filter_entity_id=${entityId}&end_time=${now.toISOString()}`
          );

          if (!history || !history[0] || history[0].length < 2) {
            return '';
          }

          const states = history[0];
          const firstVal = parseFloat(states[0].state);
          const lastVal = parseFloat(states[states.length - 1].state);

          if (isNaN(firstVal) || isNaN(lastVal)) return '';

          const diff = lastVal - firstVal;
          let trend = '';
          if (Math.abs(diff) < 0.01) {
            trend = '→';
          } else {
            trend = diff > 0 ? '↑' : '↓';
          }

          // Uložit do cache
          this._trendCache[cacheKey] = { value: trend, timestamp: Date.now() };
          return trend;
        } catch (err) {
          console.error('[PočasíMeteo] Error fetching history:', err);
          return '';
        }
      };

      // Helper to populate weather item with reference and forecast (bez "Ref:" prefixu)
      // Jednotky se doplňují podle typu
      const updateWeatherItem = (itemId, refValue, forecastValue, itemType) => {
        const refEl = sr.querySelector(`${itemId} .weather-item-reference`);
        const dividerEl = sr.querySelector(`${itemId} .weather-item-divider`);
        const forecastEl = sr.querySelector(`${itemId} .weather-item-forecast`);
        const unitEl = sr.querySelector(`${itemId} .weather-item-unit`);

        const hasReference = refValue !== null && refValue !== undefined;

        // Určit jednotku podle typu
        const getUnit = (type) => {
          const units = {
            'humidity': '%',
            'precipitation': 'mm',
            'pressure': 'hPa',
            'temperature': '°C',
            'wind': 'm/s',
            'wind_gust': 'm/s',
            'wind_direction': 's.s.',
          };
          return units[type] || '';
        };

        const unit = getUnit(itemType);

        // Populate reference (bez "Ref:" prefix, jen hodnota + trend)
        // Jen aktualizuj, pokud se obsah opravdu změnil (zabránit problikávání)
        if (refEl) {
          const newHtml = refValue || '';
          if (refEl.innerHTML !== newHtml) {
            refEl.innerHTML = newHtml;
          }
        }

        // Show divider only if reference exists
        if (dividerEl) {
          dividerEl.style.display = hasReference ? 'block' : 'none';
        }

        // Populate forecast - jen číslo
        if (forecastEl) {
          forecastEl.textContent = forecastValue;
        }

        // Populate unit (odděleně, na vlastním řádku)
        if (unitEl) {
          unitEl.textContent = unit;
          // Unit je vždy vidět, ale prázdný string se nezobrazuje
          unitEl.style.display = unit ? 'block' : 'none';
        }
      };

      // Sbírání všech trendů z historie (asynchronně)
      const trends = {};

      // Očisti computed values cache pokud se změnila hodina
      const currentHour = new Date().getHours();
      const cacheHourKey = 'lastComputedHour';
      if (this._computedValuesCache[cacheHourKey] !== currentHour) {
        this._computedValuesCache = {};
        this._displayedValuesCache = {}; // Vymaž i displayed values cache
        this._computedValuesCache[cacheHourKey] = currentHour;
      }

      // ROW 1: Vlhkost, Srážky, Tlak
      // Vlhkost
      const forecastHumidity = currentHourData.humidity !== undefined ?
        currentHourData.humidity.toFixed(0) : (a.humidity !== undefined ? a.humidity : '--');
      const refHumidityEntity = this._hass.states[this._referenceHumidityEntity];
      let refHumidityHtml = null;
      if (refHumidityEntity && refHumidityEntity.state !== 'unknown') {
        const refHumVal = parseFloat(refHumidityEntity.state);
        const forecastHumVal = parseFloat(forecastHumidity);
        const humDiff = forecastHumVal - refHumVal;
        const humDiffStr = humDiff >= 0 ? `+${humDiff.toFixed(0)}` : `${humDiff.toFixed(0)}`;
        const trendPromise = getTrendFromHistory(this._referenceHumidityEntity);
        trends.humidity = { element: null, promise: trendPromise };
        console.log('[PočasíMeteo] Humidity trend added:', { refHumVal, humDiff, humDiffStr, entity: this._referenceHumidityEntity });
        // Inicializuj trend z cache, pokud existuje
        let humidityTrend = '→';
        if (this._displayedValuesCache['humidity']) {
          humidityTrend = this._displayedValuesCache['humidity'];
        }
        refHumidityHtml = `${refHumVal.toFixed(0)}<br/><span style="font-size: 8px; opacity: 0.6;">${humDiffStr} <span class="weather-item-trend humidity-trend">${humidityTrend}</span></span>`;
      } else {
        console.log('[PočasíMeteo] No humidity entity:', this._referenceHumidityEntity);
      }
      updateWeatherItem('#humidityCell', refHumidityHtml, forecastHumidity, 'humidity');
      this._styleWeatherItem('#humidityCell', !!refHumidityHtml);

      // Srážky (precipitation increment) - přírůstek za poslední hodinu
      const forecastPrecip = currentHourData.precipitation !== undefined ?
        currentHourData.precipitation.toFixed(1) : (a.precipitation !== undefined ? a.precipitation.toFixed(1) : '0');
      const refRainfallEntity = this._hass.states[this._referenceRainfallEntity];
      let refRainfallHtml = null;
      if (refRainfallEntity && refRainfallEntity.state !== 'unknown') {
        // Srážky: nárůst entity za poslední hodinu a rozdíl oproti předpovědi
        const getPrecipIncrement = async (entityId, forecastVal) => {
          if (!entityId || !this._hass) return { value: '0', diff: '+0' };

          // Zkontroluj cache - pokud je z aktuální hodiny, vrať cached hodnotu
          const cacheKey = `precip_${entityId}_${new Date().getHours()}`;
          if (this._computedValuesCache[cacheKey]) {
            return this._computedValuesCache[cacheKey];
          }

          const now = new Date();
          const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
          try {
            const history = await this._hass.callApi(
              'get',
              `history/period/${hourStart.toISOString()}?filter_entity_id=${entityId}&end_time=${now.toISOString()}`
            );
            if (!history || !history[0] || history[0].length < 2) return { value: '0', diff: '+0' };
            const states = history[0];
            const firstVal = parseFloat(states[0].state);
            const lastVal = parseFloat(states[states.length - 1].state);
            if (isNaN(firstVal) || isNaN(lastVal)) return { value: '0', diff: '+0' };
            const increment = Math.max(0, lastVal - firstVal);
            const forecastNum = isNaN(parseFloat(forecastVal)) ? 0 : parseFloat(forecastVal);
            const diff = forecastNum - increment;
            const diffStr = diff >= 0 ? `+${diff.toFixed(1)}` : `${diff.toFixed(1)}`;
            const result = { value: increment.toFixed(1), diff: diffStr };
            // Uložit do cache
            this._computedValuesCache[cacheKey] = result;
            return result;
          } catch (err) {
            console.error('[PočasíMeteo] Error fetching rainfall history:', err);
            return { value: '0', diff: '+0' };
          }
        };
        const trendPromise = getTrendFromHistory(this._referenceRainfallEntity);
        const precipPromise = getPrecipIncrement(this._referenceRainfallEntity, forecastPrecip);
        trends.precipitation = { element: null, promise: trendPromise };
        // Spoj obě values do jednoho Promise, aby se vykonaly najednou
        const precipAndDiffPromise = precipPromise.then(r => `${r.value}|${r.diff}`);
        trends.precipitation_value = { element: null, promise: precipAndDiffPromise.then(val => val.split('|')[0]) };
        trends.precipitation_diff = { element: null, promise: precipAndDiffPromise.then(val => val.split('|')[1]) };

        // Inicializuj HTML s cached hodnotou, pokud existuje
        let precipPlaceholder = '--';
        let diffPlaceholder = '--';
        if (this._displayedValuesCache['precipitation_combined']) {
          const cached = this._displayedValuesCache['precipitation_combined'].split('|');
          precipPlaceholder = cached[0] || '--';
          diffPlaceholder = cached[1] || '--';
        }

        // Inicializuj trend z cache, pokud existuje
        let precipitationTrend = '→';
        if (this._displayedValuesCache['precipitation']) {
          precipitationTrend = this._displayedValuesCache['precipitation'];
        }

        // Build HTML for precipitation with value placeholder that will be filled asynchronously
        refRainfallHtml = `<span class="precipitation-value">${precipPlaceholder}</span><br/><span style="font-size: 8px; opacity: 0.6;"><span class="precipitation-diff">${diffPlaceholder}</span> <span class="weather-item-trend precipitation-trend">${precipitationTrend}</span></span>`;
      }
      updateWeatherItem('#precipitationCell', refRainfallHtml, forecastPrecip, 'precipitation');
      this._styleWeatherItem('#precipitationCell', !!refRainfallHtml);

      // Tlak (pressure)
      const forecastPressure = a.pressure !== undefined ? Math.round(a.pressure) : '--';
      const refPressureEntity = this._hass.states[this._referencePressureEntity];
      let refPressureHtml = null;
      if (refPressureEntity && refPressureEntity.state !== 'unknown') {
        const refPressVal = Math.round(parseFloat(refPressureEntity.state));
        const forecastPressVal = parseFloat(forecastPressure);
        const pressDiff = forecastPressVal - refPressVal;
        const pressDiffStr = pressDiff >= 0 ? `+${pressDiff.toFixed(0)}` : `${pressDiff.toFixed(0)}`;
        const trendPromise = getTrendFromHistory(this._referencePressureEntity);
        trends.pressure = { element: null, promise: trendPromise };
        // Inicializuj trend z cache, pokud existuje
        let pressureTrend = '→';
        if (this._displayedValuesCache['pressure']) {
          pressureTrend = this._displayedValuesCache['pressure'];
        }
        refPressureHtml = `${refPressVal}<br/><span style="font-size: 8px; opacity: 0.6;">${pressDiffStr} <span class="weather-item-trend pressure-trend">${pressureTrend}</span></span>`;
      }
      updateWeatherItem('#pressureCell', refPressureHtml, forecastPressure, 'pressure');
      this._styleWeatherItem('#pressureCell', !!refPressureHtml);

      // ROW 2: Teplota (2 cols), Vítr, Nárazy, Směr
      // Teplota (2 columns)
      const forecastTemp = currentHourData.temperature !== undefined ?
        currentHourData.temperature.toFixed(1) : (a.temperature !== undefined ? a.temperature.toFixed(1) : '--');
      const refTempEntity = this._hass.states[this._bestMatchTemperatureEntity];
      let refTempHtml = null;
      if (refTempEntity && refTempEntity.state !== 'unknown') {
        const refTemp = parseFloat(refTempEntity.state);
        const forecastTempNum = parseFloat(forecastTemp);
        if (!isNaN(refTemp) && !isNaN(forecastTempNum)) {
          const tempDiff = forecastTempNum - refTemp;
          const tempDiffStr = tempDiff >= 0 ? `+${tempDiff.toFixed(1)}` : `${tempDiff.toFixed(1)}`;
          const trendPromise = getTrendFromHistory(this._bestMatchTemperatureEntity);
          trends.temperature = { element: null, promise: trendPromise };
          // Inicializuj trend z cache, pokud existuje
          let temperatureTrend = '→';
          if (this._displayedValuesCache['temperature']) {
            temperatureTrend = this._displayedValuesCache['temperature'];
          }
          refTempHtml = `${refTemp.toFixed(1)}<br/><span style="font-size: 8px; opacity: 0.6;">${tempDiffStr} <span class="weather-item-trend temperature-trend">${temperatureTrend}</span></span>`;
        }
      }
      updateWeatherItem('#temperatureCell', refTempHtml, forecastTemp, 'temperature');
      this._styleWeatherItem('#temperatureCell', !!refTempHtml);

      // Vítr (wind_speed)
      const forecastWind = currentHourData.wind_speed !== undefined ?
        currentHourData.wind_speed.toFixed(1) : (a.wind_speed !== undefined ? a.wind_speed.toFixed(1) : '--');
      const refWindEntity = this._hass.states[this._referenceWindEntity];
      let refWindHtml = null;
      if (refWindEntity && refWindEntity.state !== 'unknown') {
        const refWindVal = parseFloat(refWindEntity.state);
        const forecastWindVal = parseFloat(forecastWind);
        const windDiff = forecastWindVal - refWindVal;
        const windDiffStr = windDiff >= 0 ? `+${windDiff.toFixed(1)}` : `${windDiff.toFixed(1)}`;
        const trendPromise = getTrendFromHistory(this._referenceWindEntity);
        // Get max wind speed from history for current hour
        const maxWindPromise = (async () => {
          const cacheKey = `wind_max_${this._referenceWindEntity}_${new Date().getHours()}`;
          if (this._computedValuesCache[cacheKey]) {
            return this._computedValuesCache[cacheKey];
          }

          const now = new Date();
          const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
          try {
            const history = await this._hass.callApi('get',
              `history/period/${hourStart.toISOString()}?filter_entity_id=${this._referenceWindEntity}&end_time=${now.toISOString()}`);
            if (!history || !history[0] || history[0].length === 0) return refWindVal.toFixed(1);
            const maxVal = Math.max(...history[0].map(s => parseFloat(s.state) || 0));
            const result = maxVal.toFixed(1);
            this._computedValuesCache[cacheKey] = result;
            return result;
          } catch { return refWindVal.toFixed(1); }
        })();
        trends.wind = { element: null, promise: trendPromise };
        trends.wind_max = { element: null, promise: maxWindPromise };

        // Inicializuj trend z cache, pokud existuje
        let windTrend = '→';
        if (this._displayedValuesCache['wind']) {
          windTrend = this._displayedValuesCache['wind'];
        }

        // Inicializuj HTML - wind_max se bude načítat asynchroně
        refWindHtml = `${refWindVal.toFixed(1)}<br/><span style="font-size: 8px; opacity: 0.6;"><span class="wind-max-value">--</span> <span class="weather-item-trend wind-trend">${windTrend}</span></span>`;
      }
      updateWeatherItem('#windCell', refWindHtml, forecastWind, 'wind');
      this._styleWeatherItem('#windCell', !!refWindHtml);

      // Nárazy (wind gust)
      const forecastGust = currentHourData.wind_gust !== undefined ?
        currentHourData.wind_gust.toFixed(1) : (a.wind_gust !== undefined ? a.wind_gust.toFixed(1) : '--');
      const refGustEntity = this._hass.states[this._referenceWindGustEntity];
      let refGustHtml = null;
      if (refGustEntity && refGustEntity.state !== 'unknown') {
        const refGustVal = parseFloat(refGustEntity.state);
        const forecastGustVal = parseFloat(forecastGust);
        const gustDiff = forecastGustVal - refGustVal;
        const gustDiffStr = gustDiff >= 0 ? `+${gustDiff.toFixed(1)}` : `${gustDiff.toFixed(1)}`;
        const trendPromise = getTrendFromHistory(this._referenceWindGustEntity);
        // Get max wind gust from history for current hour
        const maxGustPromise = (async () => {
          const cacheKey = `gust_max_${this._referenceWindGustEntity}_${new Date().getHours()}`;
          if (this._computedValuesCache[cacheKey]) {
            return this._computedValuesCache[cacheKey];
          }

          const now = new Date();
          const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
          try {
            const history = await this._hass.callApi('get',
              `history/period/${hourStart.toISOString()}?filter_entity_id=${this._referenceWindGustEntity}&end_time=${now.toISOString()}`);
            if (!history || !history[0] || history[0].length === 0) return refGustVal.toFixed(1);
            const maxVal = Math.max(...history[0].map(s => parseFloat(s.state) || 0));
            const result = maxVal.toFixed(1);
            this._computedValuesCache[cacheKey] = result;
            return result;
          } catch { return refGustVal.toFixed(1); }
        })();
        trends.wind_gust = { element: null, promise: trendPromise };
        trends.wind_gust_max = { element: null, promise: maxGustPromise };

        // Inicializuj trend z cache, pokud existuje
        let gustTrend = '→';
        if (this._displayedValuesCache['wind_gust']) {
          gustTrend = this._displayedValuesCache['wind_gust'];
        }

        // Inicializuj HTML - wind_gust_max se bude načítat asynchroně
        refGustHtml = `${refGustVal.toFixed(1)}<br/><span style="font-size: 8px; opacity: 0.6;"><span class="wind-gust-max-value">--</span> <span class="weather-item-trend wind-gust-trend">${gustTrend}</span></span>`;
      }
      updateWeatherItem('#windGustCell', refGustHtml, forecastGust, 'wind_gust');
      this._styleWeatherItem('#windGustCell', !!refGustHtml);

      // Směr (wind direction) - bez jednotky, ale se zarovnáním jako ostatní (prázdný řádek s tendencí)
      const forecastWindDir = a.wind_direction_czech || '--';
      const refWindDirEntity = this._hass.states[this._referenceWindDirectionEntity];
      let refWindDirHtml = null;
      if (refWindDirEntity && refWindDirEntity.state !== 'unknown') {
        const trendPromise = getTrendFromHistory(this._referenceWindDirectionEntity);
        trends.wind_direction = { element: null, promise: trendPromise };
        // Přidej prázdný řádek pod hodnotou pro zarovnání s ostatními
        // Wind direction - bez trendu, jen prázdný řádek pro zarovnání
        refWindDirHtml = `${refWindDirEntity.state}<br/><span style="font-size: 8px; opacity: 0.6;"><span style="visibility: hidden;">--</span></span>`;
      }
      updateWeatherItem('#windDirectionCell', refWindDirHtml, forecastWindDir, 'wind_direction');
      this._styleWeatherItem('#windDirectionCell', !!refWindDirHtml);

      // Doplnit trendy a hodnoty z historie po jejich načtení
      const trendEntries = Object.entries(trends);
      if (trendEntries.length > 0) {
        // Zpracuj precipitation_value a precipitation_diff najednou aby se nerozsynchronizovaly
        const precipValuePromise = trends.precipitation_value?.promise;
        const precipDiffPromise = trends.precipitation_diff?.promise;

        if (precipValuePromise && precipDiffPromise) {
          Promise.all([precipValuePromise, precipDiffPromise]).then(([value, diff]) => {
            // Zkontroluj obě hodnoty najednou pro blikání
            const combined = `${value}|${diff}`;
            const cacheKey = 'precipitation_combined';

            // Pokud je toto PRVNÍ načtení (cache je undefined), vždy aktualizuj
            // Pokud se hodnota změnila, taky aktualizuj
            // Jinak přeskoč
            if (this._displayedValuesCache[cacheKey] !== undefined && this._displayedValuesCache[cacheKey] === combined) {
              return; // Hodnota se nezměnila a už jsme ji jednou zobrazili
            }
            this._displayedValuesCache[cacheKey] = combined;

            // Najdi elementy několikrát pokud neexistují (shadow DOM se ještě renderuje)
            let attempts = 0;
            const maxAttempts = 50; // 500ms max
            const updatePrecipDisplay = () => {
              const valueEl = sr.querySelector('#precipitationCell .precipitation-value');
              const diffEl = sr.querySelector('#precipitationCell .precipitation-diff');

              if (valueEl && diffEl) {
                // Elementy existují - aktualizuj je
                valueEl.textContent = value;
                diffEl.textContent = diff;
              } else if (attempts < maxAttempts) {
                // Elementy ještě neexistují - zkus později
                attempts++;
                setTimeout(updatePrecipDisplay, 10);
              }
            };

            // Začni hledat elementy
            updatePrecipDisplay();
          }).catch(err => {
            console.error('[PočasíMeteo] Error in precipitation Promise.all:', err);
          });
        }

        // Zpracuj wind_max a wind_gust_max zvlášť (stejně jako precipitation)
        const windMaxPromise = trends.wind_max?.promise;
        const windGustMaxPromise = trends.wind_gust_max?.promise;

        if (windMaxPromise) {
          windMaxPromise.then(value => {
            // Vždy aktualizuj wind_max - nechceme cache check zde, máx. hodnota se během hodiny mění
            this._displayedValuesCache['wind_max'] = value;

            let attempts = 0;
            const maxAttempts = 50;
            const updateWindMax = () => {
              const el = sr.querySelector('#windCell .wind-max-value');
              if (el) {
                el.textContent = value;
              } else if (attempts < maxAttempts) {
                attempts++;
                setTimeout(updateWindMax, 10);
              }
            };
            updateWindMax();
          }).catch(err => console.error('[PočasíMeteo] Error updating wind_max:', err));
        }

        if (windGustMaxPromise) {
          windGustMaxPromise.then(value => {
            // Vždy aktualizuj wind_gust_max - nechceme cache check zde, máx. hodnota se během hodiny mění
            this._displayedValuesCache['wind_gust_max'] = value;

            let attempts = 0;
            const maxAttempts = 50;
            const updateGustMax = () => {
              const el = sr.querySelector('#windGustCell .wind-gust-max-value');
              if (el) {
                el.textContent = value;
              } else if (attempts < maxAttempts) {
                attempts++;
                setTimeout(updateGustMax, 10);
              }
            };
            updateGustMax();
          }).catch(err => console.error('[PočasíMeteo] Error updating wind_gust_max:', err));
        }

        // Zpracuj ostatní trendy normálně
        trendEntries.forEach(([key, data]) => {
          // Přeskočit už zpracované valores
          if (key.startsWith('precipitation_') || key === 'wind_max' || key === 'wind_gust_max') return;

          if (data.promise) {
            data.promise.then(value => {
              // Zkontroluj, zda se hodnota změnila (cache)
              // Aktualizuj pokud: 1) PRVNÍ načtení (cache je undefined), NEBO 2) hodnota se změnila
              if (this._displayedValuesCache[key] !== undefined && this._displayedValuesCache[key] === value) {
                return; // Hodnota se nezměnila a už jsme ji jednou zobrazili
              }
              this._displayedValuesCache[key] = value;

              const updateElement = () => {
                let element = data.element;
                // Pokud element není nastaven, zkus ho najít podle klíče
                if (!element) {
                  if (key === 'temperature') {
                    element = sr.querySelector('#temperatureCell .temperature-trend');
                  } else if (key === 'humidity') {
                    element = sr.querySelector('#humidityCell .humidity-trend');
                  } else if (key === 'precipitation') {
                    element = sr.querySelector('#precipitationCell .precipitation-trend');
                  } else if (key === 'pressure') {
                    element = sr.querySelector('#pressureCell .pressure-trend');
                  } else if (key === 'wind') {
                    element = sr.querySelector('#windCell .wind-trend');
                  } else if (key === 'wind_gust') {
                    element = sr.querySelector('#windGustCell .wind-gust-trend');
                  } else if (key === 'wind_direction') {
                    element = sr.querySelector('#windDirectionCell .wind-direction-trend');
                  }
                }
                if (element) {
                  element.textContent = value;
                  // Odkryj element když se hodnota nachází
                  if (element.style.display === 'none') {
                    element.style.display = '';
                  }
                }
              };

              // Zkus aktualizovat hned, pokud element neexistuje zkus později
              let element = data.element;
              if (!element) {
                if (key === 'temperature') {
                  element = sr.querySelector('#temperatureCell .temperature-trend');
                } else if (key === 'humidity') {
                  element = sr.querySelector('#humidityCell .humidity-trend');
                } else if (key === 'precipitation') {
                  element = sr.querySelector('#precipitationCell .precipitation-trend');
                } else if (key === 'pressure') {
                  element = sr.querySelector('#pressureCell .pressure-trend');
                } else if (key === 'wind') {
                  element = sr.querySelector('#windCell .wind-trend');
                } else if (key === 'wind_gust') {
                  element = sr.querySelector('#windGustCell .wind-gust-trend');
                } else if (key === 'wind_direction') {
                  element = sr.querySelector('#windDirectionCell .wind-direction-trend');
                }
              }
              if (element) {
                updateElement();
              } else {
                setTimeout(updateElement, 0);
              }
            }).catch(err => console.error(`[PočasíMeteo] Error updating ${key}:`, err));
          }
        });
      }

      // Time and date are now updated via _updateSystemTime() interval
      // No need to get from JSON attributes anymore

      // Data age
      if (a.data_age_minutes !== undefined) {
        sr.querySelector('#dataAge').textContent = `Data je ${a.data_age_minutes} minut stará`;
      }

      // Stale warning
      sr.querySelector('#staleWarning').style.display = a.data_stale ? 'block' : 'none';

      // Icon - PNG z JSON
      // API vrací správnou ikonu (s d/n suffixem) - nepotřebujeme dalších úprav
      const iconEl = sr.querySelector('#icon');
      if (iconEl) {
        this._loadForecastIcon(iconEl, a.icon_code, a.condition || 'unknown', null, false);
      }

      // Weather description (Jasno, Polojasno, déšť, atd.)
      const weatherDescEl = sr.querySelector('#weatherDescription');
      if (weatherDescEl) {
        const description = this._getWeatherDescription(a.cloudiness, a.precipitation);
        weatherDescEl.textContent = description || '--';
      }

      // Sunrise and sunset times
      const sunriseEl = sr.querySelector('#sunrise');
      if (sunriseEl && a.sunrise) {
        sunriseEl.textContent = a.sunrise;
      }
      const sunsetEl = sr.querySelector('#sunset');
      if (sunsetEl && a.sunset) {
        sunsetEl.textContent = a.sunset;
      }

      // Update precision info
      this._availableModels.forEach(model => {
        const precisionEl = sr.querySelector(`#precision-${model.name}`);
        if (precisionEl) {
          const modelEntity = this._hass.states[model.entityId];
          if (modelEntity && modelEntity.attributes.data_age_minutes !== undefined) {
            precisionEl.textContent = `${modelEntity.attributes.data_age_minutes}m`;
          }
        }
      });

      // Hourly forecast - Chart visualization
      const hourly = sr.querySelector('#hourly');
      if (a.forecast_hourly && Array.isArray(a.forecast_hourly)) {
        // Prepare data for chart
        const now = new Date();
        const currentTimestamp = now.getTime();
        const chartData = [];

        // Collect hourly data starting from current/next hour, limit to hourly_hours
        let hoursCollected = 0;
        for (const f of a.forecast_hourly) {
          if (hoursCollected >= this._hourlyHours) break;

          const dt = new Date(f.datetime || f.forecast_time);

          // Include current and future hours (compare timestamps, not just hours)
          if (dt.getTime() >= currentTimestamp) {
            // Normalize icon_code - remove .png if present
            let iconCode = f.icon_code || 'unknown';
            if (typeof iconCode === 'string' && iconCode.endsWith('.png')) {
              iconCode = iconCode.slice(0, -4);
            }

            const entry = {
              time: dt.toLocaleTimeString('cs-CZ', { hour: '2-digit' }),
              temperature: f.temperature !== undefined ? f.temperature : null,
              precipitation: f.precipitation !== undefined ? f.precipitation : 0,
              wind_speed: f.wind_speed !== undefined ? f.wind_speed : null,
              humidity: f.humidity !== undefined ? f.humidity : null,
              icon_code: iconCode,
              condition: f.condition || 'unknown',
              datetime: dt
            };
            chartData.push(entry);
            if (hoursCollected < 3) {
              console.log(`📊 Chart entry ${hoursCollected}: time=${entry.time}, temp=${entry.temperature}, precip=${entry.precipitation}, icon=${entry.icon_code}`);
            }
            hoursCollected++;
          }
        }

        // Render chart
        this._renderHourlyChart(hourly, chartData);
      }

      // Daily forecast
      const daily = sr.querySelector('#daily');
      if (a.forecast_daily && Array.isArray(a.forecast_daily)) {
        daily.innerHTML = '';
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        a.forecast_daily.forEach((f, idx) => {
          const div = document.createElement('div');
          div.className = 'daily-item';

          const dt = new Date(f.datetime || f.forecast_time);
          const forecastDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
          const day = dt.toLocaleDateString('cs-CZ', { weekday: 'short' });
          const max = f.temperature !== undefined ? Math.round(f.temperature) : '--';
          const min = f.templow !== undefined ? Math.round(f.templow) : '--';
          const rain = f.precipitation !== undefined ? f.precipitation : 0;
          const rainIcon = this._getPrecipitationIcon(f.condition || 'rainy');
          const rainDisplay = rain > 0 ? `${rainIcon} ${rain}mm` : '';
          const wind = this._formatWindInfo(f.wind_speed_max, f.wind_gust_max);

          div.innerHTML = `
            <div class="daily-day">${day}</div>
            <div class="daily-icon" id="daily-icon-${idx}">📌</div>
            <div class="daily-temps">
              <span class="daily-temp-max">${max}</span> / <span class="daily-temp-min">${min}°C</span>
            </div>
            <div class="daily-wind">${wind} m/s</div>
            ${rainDisplay ? `<div class="daily-rain">${rainDisplay}</div>` : ''}
          `;

          daily.appendChild(div);

          // Skryj data ze starých dní (včera a dnes pokud je už odpoledne)
          if (forecastDate < today) {
            div.style.display = 'none';
          } else {
            div.style.display = '';
          }

          // Load icon - předej icon_code z předpovědi (isDaily=true pro denní předpověď)
          this._loadForecastIcon(div.querySelector(`#daily-icon-${idx}`), f.icon_code, f.condition || 'unknown', f.datetime || f.forecast_time, true);
        });
      }

      // Aplikovat tile_order (skrýt dlaždice mimo tile_order a přeuspořádat)
      this._applyTileOrder();
    }

    _applyTileOrder() {
      /**
       * Aplikuje tile_order:
       * - Pokud je tile_order = default: zachovat originální layout (ikona na prvním místě)
       * - Pokud je tile_order zadán: zobrazit POUZE ty dlaždice v daném pořadí s reorderingem
       * - Skryje dlaždice mimo tile_order
       * - Přizpůsobí grid layout
       */
      const sr = this.shadowRoot;
      const currentWeather = sr.querySelector('.current-weather');
      if (!currentWeather) return;

      console.log('[PočasíMeteo] _applyTileOrder - tile_order:', this._tileOrder);

      const cellMapping = {
        'icon': '#iconCell',
        'temperature': '#temperatureCell',
        'humidity': '#humidityCell',
        'precipitation': '#precipitationCell',
        'pressure': '#pressureCell',
        'wind': '#windCell',
        'wind_gust': '#windGustCell',
        'wind_direction': '#windDirectionCell',
      };

      const allTiles = Object.keys(cellMapping);

      // Definovat default tile_order
      const defaultTileOrder = [
        'icon',
        'temperature',
        'humidity',
        'precipitation',
        'pressure',
        'wind',
        'wind_gust',
        'wind_direction'
      ];

      // Pokud je tile_order = default, neměnit nic (zachovat originální layout)
      const isDefaultOrder = JSON.stringify(this._tileOrder) === JSON.stringify(defaultTileOrder);

      if (isDefaultOrder) {
        console.log('[PočasíMeteo] DEFAULT LAYOUT detected');
        // DEFAULT LAYOUT - zobrazit vše normálně v originálním pořadí
        // Grid layout: 4 sloupce (1.2fr 1fr 1fr 1fr), 2 řádky
        // Row 1: Temperature (col 1), Humidity (col 2), Precipitation (col 3), Pressure (col 4)
        // Row 2: Icon (col 1), Wind (col 2), Wind Gust (col 3), Wind Direction (col 4)

        const gridPositioning = {
          'icon': { column: '1', row: '2' },
          'temperature': { column: '1', row: '1' },
          'humidity': { column: '2', row: '1' },
          'precipitation': { column: '3', row: '1' },
          'pressure': { column: '4', row: '1' },
          'wind': { column: '2', row: '2' },
          'wind_gust': { column: '3', row: '2' },
          'wind_direction': { column: '4', row: '2' }
        };

        allTiles.forEach(tile => {
          const cellId = cellMapping[tile];
          const cell = sr.querySelector(cellId);
          if (cell) {
            cell.style.display = '';
            const pos = gridPositioning[tile];
            if (pos) {
              cell.style.gridColumn = pos.column;
              cell.style.gridRow = pos.row;
            }
          }
        });
        // Vrátit originální grid layout (bez změny)
        currentWeather.style.gridTemplateColumns = '';
        currentWeather.style.gridTemplateRows = '';
        console.log('[PočasíMeteo] DEFAULT LAYOUT - grid reset, grid-template-columns will use CSS default');

        return;
      }

      // CUSTOM LAYOUT - aplikovat tile_order s reorderingem
      console.log('[PočasíMeteo] CUSTOM LAYOUT detected, tile count:', this._tileOrder.length);

      // Skrýt/zobrazit dlaždice podle tile_order
      allTiles.forEach(tile => {
        const cellId = cellMapping[tile];
        const cell = sr.querySelector(cellId);
        if (cell) {
          if (this._tileOrder.includes(tile)) {
            cell.style.display = '';
          } else {
            cell.style.display = 'none';
          }
          // Reset grid positioning for all tiles in custom layout
          if (this._tileOrder.includes(tile)) {
            cell.style.gridRow = '';
            cell.style.gridColumn = '';
          }
        }
      });

      // Počítat viditelné dlaždice (včetně ikony)
      const visibleCount = this._tileOrder.length;

      // Vypočítat grid layout: max 2 řádky, max 4 sloupce
      let gridColumns = '';
      if (visibleCount === 1) {
        gridColumns = '1fr';
      } else if (visibleCount === 2) {
        gridColumns = '1fr 1fr';
      } else if (visibleCount === 3) {
        gridColumns = '1fr 1fr 1fr';
      } else if (visibleCount === 4) {
        gridColumns = '1fr 1fr 1fr 1fr';
      } else if (visibleCount === 5) {
        gridColumns = '1fr 1fr 1fr';
      } else if (visibleCount === 6) {
        gridColumns = '1fr 1fr 1fr';
      } else if (visibleCount === 7) {
        gridColumns = '1fr 1fr 1fr 1fr';
      } else {
        gridColumns = '1fr 1fr 1fr 1fr';
      }

      // Aplikovat grid layout
      currentWeather.style.gridTemplateColumns = gridColumns;
      currentWeather.style.gridTemplateRows = 'auto auto';

      // Seřadit prvky v DOM podle tile_order
      const orderedElements = [];
      this._tileOrder.forEach(tile => {
        const cellId = cellMapping[tile];
        if (cellId) {
          const cell = sr.querySelector(cellId);
          if (cell && cell.style.display !== 'none') {
            orderedElements.push(cell);
          }
        }
      });

      // Přesunout elementy v DOM v správném pořadí
      orderedElements.forEach((element) => {
        if (element.parentNode === currentWeather) {
          currentWeather.removeChild(element);
        }
        currentWeather.appendChild(element);
      });
    }

    _styleWeatherItem(itemSelector, hasReference) {
      /**
       * Styluje weather item podle toho zda má reference nebo ne.
       * Pokud má reference: reference je výraznější (18px, bold), předpověď malá (11px)
       * Pokud nemá reference: předpověď je výraznější (28px, bold), na středu
       */
      const forecastEl = this.shadowRoot.querySelector(`${itemSelector} .weather-item-forecast`);
      const refEl = this.shadowRoot.querySelector(`${itemSelector} .weather-item-reference`);
      const labelEl = this.shadowRoot.querySelector(`${itemSelector} .weather-item-label`);
      const dividerEl = this.shadowRoot.querySelector(`${itemSelector} .weather-item-divider`);

      if (hasReference) {
        // Je reference - reference je výraznější, předpověď malá
        if (refEl) {
          refEl.style.fontSize = '18px';
          refEl.style.fontWeight = '700';
        }
        if (forecastEl) {
          forecastEl.style.fontSize = '11px';
          forecastEl.style.fontWeight = '500';
        }
        // Čára viditelná pouze když je reference
        if (dividerEl) dividerEl.style.display = 'block';
      } else {
        // Není reference - předpověď je výraznější a na středu
        if (dividerEl) dividerEl.style.display = 'none';
        if (forecastEl) {
          forecastEl.style.fontSize = '20px';
          forecastEl.style.fontWeight = '700';
          forecastEl.style.gridRow = '3 / 5';
        }
      }
    }

    _loadForecastIcon(iconEl, iconCode, condition, datetime, isDaily = false) {
      if (!iconEl) return;

      // Normalize icon_code - remove .png if present
      if (typeof iconCode === 'string' && iconCode.endsWith('.png')) {
        iconCode = iconCode.slice(0, -4);
      }

      // Použij nové mapování ikon z JSON
      let iconFileName = this._getWeatherIconFileName(iconCode);

      // Pokud se nepodařilo mapování, zkus podle condition
      if (iconFileName === 'otaznik.png' && condition) {
        const conditionToIcon = {
          'sunny': 'clear_day',
          'partlycloudy': 'partly_cloudy_day',
          'cloudy': 'cloudy',
          'rainy': 'rain',
          'snowy': 'snow',
          'lightning-rainy': 'zatazeno_bourka',
          'fog': 'mlha',
          'unknown': 'otaznik'
        };
        const conditionIconName = conditionToIcon[condition];
        if (conditionIconName) {
          iconFileName = this._getWeatherIconFileName(conditionIconName);
        }
      }

      const img = document.createElement('img');
      img.src = `/local/icons/${iconFileName}`;
      img.alt = condition || 'weather';

      // Fallback na emoji ikony pokud se obrázek nenačte
      img.onerror = () => {
        iconEl.innerHTML = this._getEmojiIcon(iconCode, condition);
      };

      iconEl.innerHTML = '';
      iconEl.appendChild(img);

      // Note: Scale se aplikuje na celou kartu, ne na ikonu samotnou
      // aby se dlaždice zvětšovaly jednotně
    }

    _getEmojiIcon(iconCode, condition) {
      // Mapa emoji ikon na základě icon code nebo condition
      const emojiMap = {
        'a01d': '☀️', 'a01n': '🌙',      // Slunečno / Noční
        'a02d': '⛅', 'a02n': '☁️',      // Částečně zataženo
        'a03d': '☁️', 'a03n': '☁️',      // Zataženo
        'a04d': '☁️', 'a04n': '☁️',      // Nejasno
        'a10': '🌧️',                      // Déšť
        'a11': '⛈️',                      // Bouřka
        'a13': '❄️',                      // Sníh
        'a50': '🌫️',                      // Mlha
      };

      // Pokus se najít emoji podle icon code
      if (emojiMap[iconCode]) {
        return emojiMap[iconCode];
      }

      // Fallback podle condition
      const conditionEmojiMap = {
        'sunny': '☀️',
        'partlycloudy': '⛅',
        'cloudy': '☁️',
        'rainy': '🌧️',
        'snowy': '❄️',
        'lightning-rainy': '⛈️',
        'fog': '🌫️',
      };

      return conditionEmojiMap[condition] || '🌡️';
    }

    _getWeatherIconFileName(code) {
      // Základní validace vstupu
      if (!code || typeof code !== 'string' || code === 'null') {
        return 'otaznik.png';
      }

      // Normalizace - odstranit .png pokud je přítomno
      let normalizedCode = code.endsWith('.png') ? code.slice(0, -4) : code;
      normalizedCode = normalizedCode.toLowerCase();

      // === MAPOVÁNÍ API KÓDŮ NA PNG IKONY ===
      // Defaultní logika: kód "01" → "a01.png", "46" → "a46.png", atd.

      // Defaultní mapování: přidej 'a' na začátek a '.png' na konec
      if (/^\d+[dn]?$/.test(normalizedCode)) {
        return 'a' + normalizedCode + '.png';
      }

      // === MAPOVÁNÍ SPECIFICKÝCH TEXTOVÝCH NÁZVŮ ===
      const specificIconMappings = {
        'polojasno-destova-prehanka': 'polojasno-destova-prehanka.png',
        'polojasno-snezeni': 'polojasno-snezeni.png',
        'mlha-dest': 'mlha-dest.png',
        'mlha-snih': 'mlha-snih.png',
        'mlha-snezeni': 'mlha-snih.png', // ALADIN: alias pro sníh s mlhou
        'skoro_zatazeno_dest_1': 'skoro_zatazeno_dest_1.png',
        'skoro_zatazeno_dest_2': 'skoro_zatazeno_dest_2.png',
        'skoro_zatazeno_dest_se_snehem': 'skoro_zatazeno_dest_se_snehem.png',
        'skoro_zatazeno_snezeni_1': 'skoro_zatazeno_snezeni_1.png',
        'skoro_zatazeno_snezeni_2': 'skoro_zatazeno_snezeni_2.png',
        'skoro_zatazeno_bourka_d': 'skoro_zatazeno_bourka_d.png',
        'skoro_zatazeno_bourka_n': 'skoro_zatazeno_bourka_n.png',
        'oblacno_bourka_d': 'oblacno_bourka_d.png',
        'oblacno_bourka_n': 'oblacno_bourka_n.png',
        'zatazeno_bourka': 'zatazeno_bourka.png',
        'clear_day': 'clear_day.png',
        'clear_night': 'clear_night.png',
        'partly_cloudy_day': 'partly_cloudy_day.png',
        'partly_cloudy_night': 'partly_cloudy_night.png',
        'cloudy': 'cloudy.png',
        'rain': 'rain.png',
        'snow': 'snow.png',
        'sleet': 'sleet.png',
        'fog': 'fog.png',
        'mlha': 'mlha.png',
        'skoro_zatazeno': 'skoro_zatazeno.png'
      };

      // Zkontrolovat specifické mapování
      if (specificIconMappings[normalizedCode]) {
        return specificIconMappings[normalizedCode];
      }

      // === TEXTOVÉ NÁZVY BEZ SPECIÁLNÍHO MAPOVÁNÍ ===
      if (/^[a-z_-][a-z_0-9-]*$/.test(normalizedCode)) {
        return normalizedCode + '.png';
      }

      // Poslední fallback
      return 'otaznik.png';
    }

    _getPrecipitationIcon(condition) {
      // Vrátí ikonu pro typ srážek na základě podmínky
      if (condition === 'snowy' || condition === 'snow') {
        return '❄️';
      } else if (condition === 'rainy' || condition === 'lightning-rainy' || condition === 'rain') {
        return '💧';
      }
      return '💧'; // Default
    }

    _getWindDirection(bearing) {
      // Převeď azimut (0-360°) na směr (N, NE, E, SE, atd.)
      if (bearing === undefined || bearing === null) return '--';

      const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      const index = Math.round(bearing / 22.5) % 16;
      return directions[index];
    }

    _formatWindInfo(windSpeed, windGust) {
      if (windSpeed === undefined || windSpeed === null) return '--';
      const speed = typeof windSpeed === 'number' ? windSpeed.toFixed(1) : windSpeed;
      if (windGust !== undefined && windGust !== null) {
        // wind_gust je již v m/s - bez konverze
        const gust = typeof windGust === 'number' ? windGust.toFixed(1) : windGust;
        return `${speed}↗${gust}`;
      }
      return `${speed}`;
    }

    _renderHourlyChart(container, chartData) {
      if (!chartData || chartData.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.6;">Žádné údaje</div>';
        return;
      }

      // Smart throttle for chart: Skip throttle for user-initiated updates
      // but keep throttle for automatic updates to prevent excessive redraw
      const now = Date.now();
      if (!this._userInitiatedUpdate && this._lastChartRender && (now - this._lastChartRender) < 500) {
        // Too soon for automatic update, skip redraw
        return;
      }
      this._lastChartRender = now;

      // Clear container
      container.innerHTML = '';

      // Create wrapper - fixed height to prevent jumping
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.width = '100%';
      wrapper.style.height = '200px'; // Fixed height - compact without legend
      wrapper.style.boxSizing = 'border-box';
      container.appendChild(wrapper);

      // Create canvas element
      const canvas = document.createElement('canvas');
      canvas.style.flex = '1';
      canvas.style.width = '100%';
      wrapper.appendChild(canvas);

      // Get canvas context
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set fixed canvas dimensions - use container's actual size
      // Get computed style to get stable width
      const computedStyle = window.getComputedStyle(container);
      const containerWidth = parseFloat(computedStyle.width);
      const dpr = window.devicePixelRatio || 1;

      // Fixed dimensions: 200px total height (no legend)
      const w = containerWidth || 400; // Fallback to 400px
      const h = 200; // Fixed chart height (full wrapper height)

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      // Compute margins and chart area
      const margin = { top: 15, right: 35, bottom: 40, left: 45 };
      const chartWidth = w - margin.left - margin.right;
      const chartHeight = h - margin.top - margin.bottom;

      // Find min/max temperatures - round to stable values to prevent jumping
      const temps = chartData.filter(d => d.temperature !== null).map(d => d.temperature);
      if (temps.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.6;">Žádné údaje teploty</div>';
        return;
      }

      // Round to nearest 5°C for stable axis (no extra padding)
      const rawMin = Math.min(...temps);
      const rawMax = Math.max(...temps);
      const minTemp = Math.floor(rawMin / 5) * 5; // Round down to nearest 5
      const maxTemp = Math.ceil(rawMax / 5) * 5; // Round up to nearest 5
      const tempRange = maxTemp - minTemp;

      // Find max precipitation
      const maxPrecip = Math.max(...chartData.map(d => d.precipitation), 0.1);

      // Get computed styles - use the container element for correct theme
      const style = getComputedStyle(container);
      let textColor = style.color || '#fff';
      let accentColor = '#2196F3';
      let dividerColor = 'rgba(255, 255, 255, 0.1)';

      // Try to get from CSS variables
      const rootStyle = getComputedStyle(document.documentElement);
      const primaryColor = rootStyle.getPropertyValue('--primary-color').trim();
      if (primaryColor) accentColor = primaryColor;
      const divColor = rootStyle.getPropertyValue('--divider-color').trim();
      if (divColor) dividerColor = divColor;

      // Convert CSS color to RGB (simple version)
      const getRGBColor = (cssColor) => {
        if (cssColor.startsWith('#')) {
          const hex = cssColor.replace('#', '');
          return `rgb(${parseInt(hex.substr(0, 2), 16)}, ${parseInt(hex.substr(2, 2), 16)}, ${parseInt(hex.substr(4, 2), 16)})`;
        }
        return cssColor;
      };

      ctx.fillStyle = getRGBColor(textColor);
      ctx.strokeStyle = getRGBColor(dividerColor);
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';

      // Note: Y-axis labels and precipitation label are drawn in Promise.all() callback
      // This prevents them from showing during initial chart draw (black text issue)

      // Calculate positions for data points
      const xSpacing = chartWidth / Math.max(chartData.length - 1, 1);
      const getX = (idx) => margin.left + idx * xSpacing;
      const getY = (temp) => margin.top + chartHeight - ((temp - minTemp) / tempRange) * chartHeight;
      const getYPrecip = (precip) => margin.top + chartHeight - (precip / maxPrecip) * (chartHeight * 0.4);

      // Draw precipitation bars (semi-transparent)
      chartData.forEach((d, idx) => {
        if (d.precipitation > 0) {
          const x = getX(idx);
          const yBottom = margin.top + chartHeight;
          const yTop = getYPrecip(d.precipitation);
          ctx.fillStyle = 'rgba(33, 150, 243, 0.25)';
          ctx.fillRect(x - 4, yTop, 8, yBottom - yTop);
        }
      });

      // Draw temperature line
      ctx.strokeStyle = getRGBColor(accentColor);
      ctx.lineWidth = 2;
      ctx.beginPath();
      let first = true;
      chartData.forEach((d, idx) => {
        if (d.temperature !== null) {
          const x = getX(idx);
          const y = getY(d.temperature);
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            ctx.lineTo(x, y);
          }
        }
      });
      ctx.stroke();

      // Calculate icon density step
      let iconStep = 1;
      if (chartData.length > 36) {
        iconStep = Math.ceil(chartData.length / 8); // Show ~8 icons max
      } else if (chartData.length > 24) {
        iconStep = Math.ceil(chartData.length / 10); // Show ~10 icons
      } else if (chartData.length > 12) {
        iconStep = Math.ceil(chartData.length / 12); // Show ~12 icons
      }

      // Preload icons for display - use cache to prevent flickering
      const iconSize = 20; // Size of weather icons
      const iconsToDraw = [];
      const iconLoadPromises = [];

      chartData.forEach((d, idx) => {
        if (d.temperature !== null && idx % iconStep === 0) {
          const x = getX(idx);
          const y = getY(d.temperature);
          const iconFileName = this._getWeatherIconFileName(d.icon_code);
          if (idx === 0 || idx === iconStep) {
            console.log(`🎯 Chart icon ${idx}: code=${d.icon_code}, mapped=${iconFileName}`);
          }

          // Track what needs to be drawn with temperature
          iconsToDraw.push({
            idx,
            x,
            y,
            temperature: d.temperature,
            iconFileName,
            condition: d.condition,
            iconCode: d.icon_code
          });

          // Check cache first, otherwise load
          if (this._imageCache[iconFileName]) {
            // Already cached, will be drawn immediately
            iconLoadPromises.push(Promise.resolve(this._imageCache[iconFileName]));
          } else {
            // Not in cache, load it
            const iconPromise = new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                this._imageCache[iconFileName] = img; // Cache it
                console.log(`✓ Icon loaded: ${iconFileName}`);
                resolve(img);
              };
              img.onerror = () => {
                console.warn(`✗ Icon failed to load: ${iconFileName} (code: ${d.icon_code})`);
                reject(d.icon_code);
              };
              img.src = `/local/icons/${iconFileName}`;
            });
            iconLoadPromises.push(iconPromise);
          }
        }
      });

      // Draw small dots for all points first
      chartData.forEach((d, idx) => {
        if (d.temperature !== null) {
          const x = getX(idx);
          const y = getY(d.temperature);

          if (idx % iconStep !== 0) {
            // Small dots for non-icon points
            ctx.fillStyle = getRGBColor(accentColor);
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // Load icons and draw with images + temperature labels
      Promise.all(iconLoadPromises)
        .then((images) => {
          // All icons loaded successfully, draw them with temperature
          images.forEach((img, i) => {
            const icon = iconsToDraw[i];
            ctx.drawImage(img, icon.x - iconSize / 2, icon.y - iconSize / 2, iconSize, iconSize);

            // Draw temperature above icon
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = getRGBColor(accentColor);
            ctx.fillText(Math.round(icon.temperature), icon.x, icon.y - iconSize / 2 - 2);
          });

          // Draw Y-axis labels and gridlines
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = getRGBColor(textColor);
          const tempSteps = 5;
          for (let i = 0; i <= tempSteps; i++) {
            const temp = minTemp + (tempRange / tempSteps) * i;
            const y = margin.top + chartHeight - (chartHeight / tempSteps) * i;
            ctx.fillText(Math.round(temp) + '°', margin.left - 10, y);

            // Draw subtle gridlines (only for middle steps)
            if (i > 0 && i < tempSteps) {
              ctx.beginPath();
              ctx.moveTo(margin.left + 5, y);
              ctx.lineTo(w - margin.right - 5, y);
              ctx.strokeStyle = getRGBColor(dividerColor);
              ctx.lineWidth = 0.3;
              ctx.stroke();
            }
          }

          // Note: precipitation label "mm" removed to save space

          // Draw precipitation values on right side (max 2 values to avoid overlapping)
          const precipSteps = 2;
          const precipStep = maxPrecip / precipSteps;
          for (let i = 1; i <= precipSteps; i++) {
            const precip = precipStep * i;
            const y = margin.top + chartHeight - (precip / maxPrecip) * (chartHeight * 0.4);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = '7px sans-serif';
            ctx.fillStyle = 'rgba(33, 150, 243, 0.8)';
            ctx.fillText(precip.toFixed(1), w - margin.right + 3, y);
            console.log(`📊 Precip value: ${precip.toFixed(1)} at y=${y.toFixed(0)}`);
          }

          // Draw X-axis labels (time)
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = getRGBColor(textColor);

          // Calculate step based on available width
          let step = 1;
          if (chartData.length > 36) {
            step = Math.ceil(chartData.length / 12); // Show ~12 labels max
          } else if (chartData.length > 12) {
            step = Math.ceil(chartData.length / 8); // Show ~8 labels
          }

          chartData.forEach((d, idx) => {
            if (idx % step === 0 || idx === chartData.length - 1) {
              const x = getX(idx);
              const y = margin.top + chartHeight + 8;
              ctx.fillText(d.time, x, y);
            }
          });

          // Draw bottom line
          ctx.strokeStyle = getRGBColor(dividerColor);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(margin.left, margin.top + chartHeight);
          ctx.lineTo(w - margin.right, margin.top + chartHeight);
          ctx.stroke();
        })
        .catch((failedCode) => {
          // Some icons failed, draw fallback emoji with temperature
          console.warn(`⚠ Using emoji fallback for code: ${failedCode}`);
          iconsToDraw.forEach((icon) => {
            const emoji = this._getEmojiIcon(icon.iconCode, icon.condition);
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = getRGBColor(textColor);
            ctx.fillText(emoji, icon.x, icon.y);

            // Draw temperature above emoji
            ctx.font = 'bold 10px Arial';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = getRGBColor(accentColor);
            ctx.fillText(Math.round(icon.temperature), icon.x, icon.y - 12);
          });

          // Draw Y-axis labels and gridlines
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = getRGBColor(textColor);
          const tempSteps = 5;
          for (let i = 0; i <= tempSteps; i++) {
            const temp = minTemp + (tempRange / tempSteps) * i;
            const y = margin.top + chartHeight - (chartHeight / tempSteps) * i;
            ctx.fillText(Math.round(temp) + '°', margin.left - 10, y);

            // Draw subtle gridlines (only for middle steps)
            if (i > 0 && i < tempSteps) {
              ctx.beginPath();
              ctx.moveTo(margin.left + 5, y);
              ctx.lineTo(w - margin.right - 5, y);
              ctx.strokeStyle = getRGBColor(dividerColor);
              ctx.lineWidth = 0.3;
              ctx.stroke();
            }
          }

          // Note: precipitation label "mm" removed to save space

          // Draw precipitation values on right side (max 2 values to avoid overlapping)
          const precipSteps = 2;
          const precipStep = maxPrecip / precipSteps;
          for (let i = 1; i <= precipSteps; i++) {
            const precip = precipStep * i;
            const y = margin.top + chartHeight - (precip / maxPrecip) * (chartHeight * 0.4);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = '7px sans-serif';
            ctx.fillStyle = 'rgba(33, 150, 243, 0.8)';
            ctx.fillText(precip.toFixed(1), w - margin.right + 3, y);
            console.log(`📊 Precip value: ${precip.toFixed(1)} at y=${y.toFixed(0)}`);
          }

          // Draw X-axis labels (time)
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = getRGBColor(textColor);

          // Calculate step based on available width
          let step = 1;
          if (chartData.length > 36) {
            step = Math.ceil(chartData.length / 12); // Show ~12 labels max
          } else if (chartData.length > 12) {
            step = Math.ceil(chartData.length / 8); // Show ~8 labels
          }

          chartData.forEach((d, idx) => {
            if (idx % step === 0 || idx === chartData.length - 1) {
              const x = getX(idx);
              const y = margin.top + chartHeight + 8;
              ctx.fillText(d.time, x, y);
            }
          });

          // Draw bottom line
          ctx.strokeStyle = getRGBColor(dividerColor);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(margin.left, margin.top + chartHeight);
          ctx.lineTo(w - margin.right, margin.top + chartHeight);
          ctx.stroke();
        });

      // Create tooltip element
      const tooltip = document.createElement('div');
      tooltip.className = 'hourly-forecast-tooltip';
      wrapper.appendChild(tooltip);

      // Add interactivity
      const handleMouseMove = (e) => {
        const rect = wrapper.getBoundingClientRect();
        // Account for scale transform - when scaled, coordinates need to be adjusted
        const scale = this._scale || 1.0;
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        console.log(`🖱 Mouse move - x=${x.toFixed(0)}, y=${y.toFixed(0)}, scale=${scale}, margin.left=${margin.left}, margin.right=${margin.right}, w=${w}, check: ${x >= margin.left && x <= w - margin.right}`);

        // Only react to movement within chart area (left to right margin)
        if (x < margin.left || x > w - margin.right) {
          console.log(`❌ Out of bounds - hiding tooltip`);
          tooltip.style.display = 'none';
          return;
        }

        // Find closest data point
        let closest = { idx: 0, distance: Infinity };
        chartData.forEach((d, idx) => {
          const px = getX(idx);
          const dist = Math.abs(px - x);
          if (dist < closest.distance) {
            closest = { idx, distance: dist };
          }
        });

        console.log(`📍 Closest point: idx=${closest.idx}, distance=${closest.distance.toFixed(1)}, mouse x=${x.toFixed(0)}, point px=${getX(closest.idx).toFixed(0)}`);

        if (closest.distance < 30) {
          const d = chartData[closest.idx];
          const wind = d.wind_speed !== null && d.wind_speed !== undefined ? `${d.wind_speed.toFixed(1)} m/s` : '--';
          const precip = d.precipitation !== null && d.precipitation !== undefined ? `${d.precipitation.toFixed(1)} mm` : '--';
          console.log(`🎯 Tooltip data - idx: ${closest.idx}, time: ${d.time}, temp: ${d.temperature}, precip: ${d.precipitation}, displayed: ${precip}`);

          // Format time: "dnes 21", "zítra 04", etc.
          const now = new Date();
          const forecastDate = new Date(d.datetime);
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const tomorrow = new Date(today.getTime() + 86400000);
          const forecastDateOnly = new Date(forecastDate.getFullYear(), forecastDate.getMonth(), forecastDate.getDate());

          let dayLabel = '';
          if (forecastDateOnly.getTime() === today.getTime()) {
            dayLabel = 'dnes';
          } else if (forecastDateOnly.getTime() === tomorrow.getTime()) {
            dayLabel = 'zítra';
          } else {
            dayLabel = forecastDateOnly.toLocaleDateString('cs-CZ', { weekday: 'short' });
          }

          const hour = String(forecastDate.getHours()).padStart(2, '0');
          const timeStr = `${dayLabel} ${hour}`;

          // Get PNG icon
          const iconFileName = this._getWeatherIconFileName(d.icon_code);
          console.log(`🎨 Tooltip icon: code=${d.icon_code}, fileName=${iconFileName}, cached=${!!this._imageCache[iconFileName]}`);
          const iconImg = this._imageCache[iconFileName] ?
            `<img src="/local/icons/${iconFileName}" style="width: 18px; height: 18px; margin-bottom: 2px; display: block; margin-left: auto; margin-right: auto;" alt="weather">` :
            `<div style="font-size: 20px; margin-bottom: 2px;">${this._getEmojiIcon(d.icon_code, d.condition)}</div>`;

          tooltip.innerHTML = `
            <div style="font-size: 9px; font-weight: 600; margin-bottom: 3px;">${timeStr}</div>
            ${iconImg}
            <div style="font-size: 12px; font-weight: 600; margin-bottom: 2px;">${Math.round(d.temperature)}°</div>
            <div style="font-size: 8px; opacity: 0.85; line-height: 1.1;">V: ${wind}<br/>S: ${precip}</div>
          `;
          tooltip.style.display = 'block';

          // Position tooltip above the data point (not cursor)
          const tooltipWidth = 75; // Zmenšeno z 90
          const pointX = getX(closest.idx); // Use point position, not cursor
          let left = pointX - tooltipWidth / 2;
          let top = margin.top - 10; // Position above chart area

          // Keep in bounds
          if (left < 0) left = 4;
          if (left + tooltipWidth > w) left = w - tooltipWidth - 4;

          tooltip.style.left = left + 'px';
          tooltip.style.top = top + 'px';
          console.log(`📍 Tooltip positioned: left=${left.toFixed(0)}, top=${top.toFixed(0)}, pointX=${pointX.toFixed(0)}`);
        } else {
          tooltip.style.display = 'none';
        }
      };

      const handleMouseLeave = () => {
        // Hide tooltip with delay so it's visible a bit longer
        if (this._tooltipHideTimeout) {
          clearTimeout(this._tooltipHideTimeout);
        }
        this._tooltipHideTimeout = setTimeout(() => {
          tooltip.style.display = 'none';
        }, 800); // Keep tooltip visible for 800ms after mouse leaves
      };

      // Add listeners to wrapper to catch movement on entire area including right side
      wrapper.addEventListener('mousemove', handleMouseMove);
      wrapper.addEventListener('mouseleave', handleMouseLeave);
    }

    _isCurrentlyAfterSunset(sunsetTimeStr) {
      // Porovná aktuální čas se západem slunce (formát "HH:MM")
      // Vrací TRUE když je DEN (PŘED západem) - vrací FALSE když je NOČ (PO západu)
      if (!sunsetTimeStr || typeof sunsetTimeStr !== 'string') return true; // Default: den

      const now = new Date();
      const [sunsetHours, sunsetMinutes] = sunsetTimeStr.split(':').map(Number);

      const sunsetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sunsetHours, sunsetMinutes);

      // Vrátí true když je PŘED západem (je den)
      return now < sunsetTime;
    }

    _getIconCodeWithNightAdjustment(iconCode, isNight) {
      // Pokud je noc a ikona je denní, změní 'd' na 'n'
      if (isNight && iconCode && iconCode.endsWith('d')) {
        return iconCode.replace(/d$/, 'n');
      }
      return iconCode;
    }

    async _loadTodayHoliday() {
      // Načti svátek na dnes z API - cache na 24 hodin
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; // YYYY-MM-DD
      const todayKey = dateStr;

      // Pokud jsme už dneska fetchli, použij cache
      if (this._holidayFetchDate === todayKey && this._todayHoliday !== undefined) {
        return this._todayHoliday;
      }

      try {
        // Použij správný endpoint s datem: https://svatkyapi.cz/api/day?date=2025-11-21
        const response = await fetch(`https://svatkyapi.cz/api/day?date=${dateStr}`);

        if (!response.ok) {
          console.warn('Failed to fetch holiday data:', response.status);
          this._todayHoliday = '---';
          this._holidayFetchDate = todayKey;
          return '---';
        }

        const data = await response.json();

        // Vytáhni jméno z response
        // Response má strukturu: { "name": "Albert", "isHoliday": false, ... }
        if (data && data.name) {
          this._todayHoliday = data.name;
        } else {
          this._todayHoliday = '---';
        }

        this._holidayFetchDate = todayKey;
        console.log('Holiday loaded:', this._todayHoliday);
        return this._todayHoliday;
      } catch (error) {
        console.warn('Error loading holiday:', error);
        this._todayHoliday = '---';
        this._holidayFetchDate = todayKey;
        return '---';
      }
    }

    static getStubConfig() {
      return {
        type: 'custom:pocasimeteo-card',
        entity: 'weather.pocasimeteo_praha_6_ruzyne',
        // Volitelné: entita teploty pro automatickou detekci nejpřesnějšího modelu
        best_match_temperature_entity: 'sensor.outdoor_temperature',
        // Volitelné: seznam modelů k zobrazení
        models: [
          { name: 'MASTER', label: 'Master' },
          { name: 'ALADIN', label: 'ALADIN' },
          { name: 'ICON', label: 'ICON' },
          { name: 'GFS', label: 'GFS' },
          { name: 'ECMWF', label: 'ECMWF' }
        ],
        // Konfigurační možnosti:
        full_width: false,                      // true = karta přes celou šířku
        show_current_weather: true,             // Zobrazit aktuální počasí
        show_hourly_forecast: true,             // Zobrazit hodinovou předpověď
        show_daily_forecast: true               // Zobrazit denní předpověď
      };
    }

    _updateModelAccuracy() {
      // Track model accuracy by comparing forecast temps vs reference entity over 6 hours
      if (!this._hass || !this._bestMatchTemperatureEntity || !this._availableModels.length) {
        return;
      }

      const refEntity = this._hass.states[this._bestMatchTemperatureEntity];
      if (!refEntity || refEntity.state === 'unknown') {
        return;
      }

      try {
        const refTemp = parseFloat(refEntity.state);
        if (isNaN(refTemp)) {
          return;
        }

        const now = Date.now();
        const sixHoursMs = 6 * 60 * 60 * 1000;

        // Load existing accuracy history from localStorage
        let accuracyHistory = {};
        try {
          const stored = localStorage.getItem(this._modelHistoryKey);
          if (stored) {
            accuracyHistory = JSON.parse(stored);
          }
        } catch (e) {
          console.warn('Could not load accuracy history from localStorage:', e);
        }

        // Record current accuracy for each model
        this._availableModels.forEach(model => {
          const modelEntity = this._hass.states[model.entityId];
          if (!modelEntity || !modelEntity.attributes) {
            return;
          }

          const forecastTemp = modelEntity.attributes.temperature;
          if (forecastTemp === undefined) {
            return;
          }

          const error = Math.abs(forecastTemp - refTemp);

          // Initialize model history if needed
          if (!accuracyHistory[model.name]) {
            accuracyHistory[model.name] = [];
          }

          // Add current measurement
          accuracyHistory[model.name].push({
            error: error,
            timestamp: now
          });

          // Remove old entries (older than 6 hours)
          accuracyHistory[model.name] = accuracyHistory[model.name].filter(
            entry => (now - entry.timestamp) < sixHoursMs
          );
        });

        // Save updated history
        try {
          localStorage.setItem(this._modelHistoryKey, JSON.stringify(accuracyHistory));
        } catch (e) {
          console.warn('Could not save accuracy history to localStorage:', e);
        }

        // Calculate average errors and color tiers
        this._modelAccuracy = {};
        for (const [modelName, measurements] of Object.entries(accuracyHistory)) {
          if (measurements.length > 0) {
            const totalError = measurements.reduce((sum, m) => sum + m.error, 0);
            const avgError = totalError / measurements.length;

            this._modelAccuracy[modelName] = {
              average_error: avgError,
              count: measurements.length,
              tier: avgError <= 0.3 ? 'green' : avgError <= 0.8 ? 'yellow' : 'red'
            };
          }
        }

        // Recalculate model scores with fresh data
        this._modelScores = this._calculateModelScores();

        // Update model tabs with new colors and scores
        this._setupModelTabs();

      } catch (error) {
        console.warn('Error calculating model accuracy:', error);
      }
    }

    _getModelAccuracyDisplay(modelName) {
      // Get accuracy color and tooltip for a model using extended scoring
      if (!this._modelScores || !this._modelScores[modelName]) {
        return { tier: 'gray', tooltip: 'Bez dat', score: '' };
      }

      const scoreData = this._modelScores[modelName];
      const { score, tier, breakdown } = scoreData;

      // Zjisti, zda máme nějaké reference entity
      const hasReferenceEntities = this._bestMatchTemperatureEntity ||
                                   this._referenceHumidityEntity ||
                                   this._referenceRainfallEntity ||
                                   this._referenceWindEntity ||
                                   this._referenceWindGustEntity ||
                                   this._referencePressureEntity;

      // Build tooltip s parameter breakdown jen když máme reference entity
      let tooltipParts = [];
      if (hasReferenceEntities) {
        if (breakdown.temperature !== undefined) {
          tooltipParts.push(`Tep: ${breakdown.temperature.error.toFixed(1)}°C`);
        }
        if (breakdown.humidity !== undefined) {
          tooltipParts.push(`Vlh: ${breakdown.humidity.error.toFixed(1)}%`);
        }
        if (breakdown.precipitation !== undefined) {
          tooltipParts.push(`Srá: ${breakdown.precipitation.error.toFixed(1)}mm`);
        }
        if (breakdown.wind !== undefined) {
          tooltipParts.push(`Vítr: ${breakdown.wind.error.toFixed(1)}m/s`);
        }
        if (breakdown.wind_gust !== undefined) {
          tooltipParts.push(`Náraz: ${breakdown.wind_gust.error.toFixed(1)}m/s`);
        }
        if (breakdown.pressure !== undefined) {
          tooltipParts.push(`Tlak: ${breakdown.pressure.error.toFixed(1)}hPa`);
        }
      }

      const tooltip = hasReferenceEntities ?
        `Skóre: ${score}%\n${tooltipParts.join(' | ')}` :
        'Skóre neukazováno (bez reference entit)';

      return {
        tier: tier || 'gray',
        tooltip: tooltip,
        score: hasReferenceEntities ? `${score}%` : ''
      };
    }

    getCardSize() {
      return 10;
    }
  }

  customElements.define('pocasimeteo-card', PocasimeteoCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'pocasimeteo-card',
    name: 'PočasíMeteo Card',
    description: 'Modern weather forecast with multiple model selection'
  });
})();
