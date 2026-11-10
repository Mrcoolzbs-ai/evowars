// ============================================
// APP - Основной компонент приложения
// ============================================

import { useState, useEffect } from 'react';
import { generateWorld, generateRandomSeed, generateMultipleWorlds } from './modules/Generator';
import { getAllWorlds, saveWorld, deleteWorld, clearAllWorlds, saveSettings, getSettings, saveLastSeed, getLastSeed } from './modules/Storage';
import { createShortDescription } from './modules/WorldModel';
import { getAllPresets } from './modules/Atmosphere';
import { runChemicalEvolutionStep, runWorldKineticTrajectory, resetWorldKineticExperiment } from './modules/ChemicalEvolution';
import type { GenerationSettings, GeneratedWorld, SavedWorld, GenerationMode, FixedCategories, ID, PhysValue, ScientificConfidence } from './types';
import { cosmologies, epochs, centralObjects, celestialBodies, cradles, gases } from './modules/Data';

import './App.css';

// ============================================
// КОМПОНЕНТЫ
// ============================================

// Компонент для генератора
function GeneratorPanel(props: {
  onGenerate: (world: GeneratedWorld) => void;
  onGenerateMultiple: (worlds: GeneratedWorld[]) => void;
  settings: GenerationSettings;
  onSettingsChange: (settings: GenerationSettings) => void;
}) {
  const [localSettings, setLocalSettings] = useState<GenerationSettings>(props.settings);

  useEffect(() => {
    setLocalSettings(props.settings);
  }, [props.settings]);

  const handleGenerate = () => {
    const world = generateWorld(localSettings);
    props.onGenerate(world);
    saveLastSeed(localSettings.seed);
    saveSettings(localSettings);
  };

  const handleGenerateMultiple = () => {
    const count = 3; // Пока фиксированное количество
    const worlds = generateMultipleWorlds(localSettings, count);
    props.onGenerateMultiple(worlds);
  };

  const handleNewSeed = () => {
    const newSeed = generateRandomSeed();
    const newSettings = { ...localSettings, seed: newSeed };
    setLocalSettings(newSettings);
    props.onSettingsChange(newSettings);
  };

  const handleSeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSettings = { ...localSettings, seed: e.target.value };
    setLocalSettings(newSettings);
  };

  const handleModeChange = (mode: GenerationMode) => {
    const newSettings = { ...localSettings, mode };
    setLocalSettings(newSettings);
    props.onSettingsChange(newSettings);
  };

  const handleFixedCategoryChange = (category: keyof FixedCategories, value: ID | undefined) => {
    const newFixed = { ...localSettings.fixedCategories, [category]: value };
    const newSettings = { ...localSettings, fixedCategories: newFixed };
    setLocalSettings(newSettings);
    props.onSettingsChange(newSettings);
  };

  return (
    <div className="generator-panel">
      <h2>Генератор условий мира</h2>
      
      <div className="settings-section">
        <div className="setting-group">
          <label>
            <span>Seed:</span>
            <input
              type="text"
              value={localSettings.seed}
              onChange={handleSeedChange}
              placeholder="Введите seed"
            />
            <button onClick={handleNewSeed}>Новый seed</button>
          </label>
        </div>

        <div className="setting-group">
          <span>Режим:</span>
          <label className="radio-label">
            <input
              type="radio"
              checked={localSettings.mode === 'realistic'}
              onChange={() => handleModeChange('realistic')}
            />
            Реалистичный
          </label>
          <label className="radio-label">
            <input
              type="radio"
              checked={localSettings.mode === 'anomalous'}
              onChange={() => handleModeChange('anomalous')}
            />
            Аномальный
          </label>
        </div>
      </div>

      <div className="fixed-categories">
        <h3>Фиксированные категории</h3>
        <div className="category-selectors">
          <CategorySelector
            label="Космология"
            options={cosmologies}
            value={localSettings.fixedCategories?.cosmology}
            onChange={(v) => handleFixedCategoryChange('cosmology', v)}
          />
          <CategorySelector
            label="Эпоха"
            options={epochs}
            value={localSettings.fixedCategories?.epoch}
            onChange={(v) => handleFixedCategoryChange('epoch', v)}
          />
          <CategorySelector
            label="Центральный объект"
            options={centralObjects}
            value={localSettings.fixedCategories?.centralObject}
            onChange={(v) => handleFixedCategoryChange('centralObject', v)}
          />
          <CategorySelector
            label="Небесное тело"
            options={celestialBodies}
            value={localSettings.fixedCategories?.celestialBody}
            onChange={(v) => handleFixedCategoryChange('celestialBody', v)}
          />
          <CategorySelector
            label="Колыбель"
            options={cradles}
            value={localSettings.fixedCategories?.cradle}
            onChange={(v) => handleFixedCategoryChange('cradle', v)}
          />
        </div>
      </div>

      <div className="atmosphere-preset">
        <h3>Атмосферный пресет</h3>
        <div className="category-selector">
          <label>Пресет:</label>
          <select
            value={localSettings.atmospherePreset || ''}
            onChange={(e) => {
              const newSettings = { ...localSettings, atmospherePreset: e.target.value || undefined };
              setLocalSettings(newSettings);
              props.onSettingsChange(newSettings);
            }}
          >
            <option value="">По умолчанию (метаново-этановая)</option>
            {Object.entries(getAllPresets()).map(([presetId]) => (
              <option key={presetId} value={presetId}>
                {presetId === 'methane_ethane'
                  ? 'Метаново-этановая (историческая игровая)'
                  : presetId === 'titan_reference'
                    ? 'Титан — наблюдательный ориентир'
                    : presetId}
              </option>
            ))}
          </select>
          {localSettings.atmospherePreset && (
            <p className="preset-note">
              {(() => {
                const preset = getAllPresets()[localSettings.atmospherePreset];
                if (!preset) return null;
                if (preset.presetKind === 'historical_game') {
                  return 'Исторический игровой сценарий. Исходные 1.5 atm и 95 K — неподтверждённые игровые допущения, не данные наблюдений.';
                }
                if (preset.presetKind === 'observational_reference') {
                  return 'Справочный ориентир на основе наблюдений реального небесного тела. Не является универсальным шаблоном для всех планет этого класса.';
                }
                return 'Пресет сгенерирует атмосферу с допустимыми вариациями состава.';
              })()}
            </p>
          )}
        </div>
      </div>

      <div className="generator-actions">
        <button onClick={handleGenerate} className="primary">
          Сгенерировать мир
        </button>
        <button onClick={handleGenerateMultiple} className="secondary">
          Сгенерировать 3 мира
        </button>
      </div>
    </div>
  );
}

// Компонент для выбора категории
function CategorySelector<T extends { id: ID; name: string }>(props: {
  label: string;
  options: T[];
  value: ID | undefined;
  onChange: (value: ID | undefined) => void;
}) {
  return (
    <div className="category-selector">
      <label>{props.label}:</label>
      <select
        value={props.value || ''}
        onChange={(e) => props.onChange(e.target.value || undefined)}
      >
        <option value="">Случайно</option>
        {props.options.map(option => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============================================
// Stage 4.5.5: кинетический эксперимент №89/№106
// ============================================
// Отдельный пользовательский расчётный сценарий в паспорте мира:
// пользователь явно настраивает толщину слоя и начальные запасы
// (они НЕ извлекаются из атмосферного состава), строит расписание
// сегментов и выполняет последовательную траекторию. Это НЕ шаг
// режима A и НЕ рассчитанная эволюция атмосферы планеты.

type KineticSpeciesKey = 'O' | 'NO' | 'NO2' | 'H' | 'O2' | 'HO2' | 'N2';

const KINETIC_EXPERIMENT_SPECIES_FIELDS: Array<{ key: KineticSpeciesKey; formula: string }> = [
  { key: 'O', formula: 'O' },
  { key: 'NO', formula: 'NO' },
  { key: 'NO2', formula: 'NO₂' },
  { key: 'H', formula: 'H' },
  { key: 'O2', formula: 'O₂' },
  { key: 'HO2', formula: 'HO₂' },
  { key: 'N2', formula: 'N₂' }
];

const KINETIC_EXPERIMENT_REACTIONS: Array<{ id: string; label: string }> = [
  { id: 'kida-tb-2015-03-19-89', label: '№89: O + NO + N₂ → NO₂ + N₂ (200–300 K)' },
  { id: 'kida-tb-2015-03-19-106', label: '№106: H + O₂ + N₂ → HO₂ + N₂ (300–400 K)' }
];

/** Черновик сегмента расписания в редакторе UI (строки, не числа). */
interface KineticSegmentDraft {
  temperatureK: string;
  dtSeconds: string;
  reactionIds: string[];
}

function emptyKineticInventoryDraft(): Record<KineticSpeciesKey, string> {
  return { O: '', NO: '', NO2: '', H: '', O2: '', HO2: '', N2: '' };
}

function formatKineticAmount(value: number): string {
  if (value === 0) {
    return '0';
  }
  return value.toExponential(4);
}

function KineticExperimentSection(props: {
  world: GeneratedWorld;
  onWorldReplace: (world: GeneratedWorld) => void;
}) {
  const world = props.world;
  const experiment = world.kineticExperiment;

  const [layerThicknessDraft, setLayerThicknessDraft] = useState('');
  const [inventoryDraft, setInventoryDraft] = useState<Record<KineticSpeciesKey, string>>(
    emptyKineticInventoryDraft()
  );
  const [scheduleDraft, setScheduleDraft] = useState<KineticSegmentDraft[]>([
    { temperatureK: '', dtSeconds: '', reactionIds: [] }
  ]);
  const [runError, setRunError] = useState<string | null>(null);

  const setSegmentField = (index: number, field: 'temperatureK' | 'dtSeconds', value: string) => {
    setScheduleDraft((drafts) =>
      drafts.map((draft, i) => (i === index ? { ...draft, [field]: value } : draft))
    );
  };

  const toggleSegmentReaction = (index: number, reactionId: string) => {
    setScheduleDraft((drafts) =>
      drafts.map((draft, i) =>
        i === index
          ? {
              ...draft,
              reactionIds: draft.reactionIds.includes(reactionId)
                ? draft.reactionIds.filter((id) => id !== reactionId)
                : [...draft.reactionIds, reactionId]
            }
          : draft
      )
    );
  };

  const addSegment = () => {
    setScheduleDraft((drafts) => [...drafts, { temperatureK: '', dtSeconds: '', reactionIds: [] }]);
  };

  const removeSegment = (index: number) => {
    setScheduleDraft((drafts) =>
      drafts.length <= 1 ? drafts : drafts.filter((_, i) => i !== index)
    );
  };

  // Явный сброс эксперимента: только по действию пользователя,
  // форма первичной настройки возвращается в пустое состояние.
  const handleReset = () => {
    props.onWorldReplace(resetWorldKineticExperiment(world));
    setLayerThicknessDraft('');
    setInventoryDraft(emptyKineticInventoryDraft());
    setScheduleDraft([{ temperatureK: '', dtSeconds: '', reactionIds: [] }]);
    setRunError(null);
  };

  const handleRun = () => {
    setRunError(null);
    const segments: Array<{ temperatureK: number; dtSeconds: number; reactionIds: string[] }> = [];
    for (let i = 0; i < scheduleDraft.length; i++) {
      const draft = scheduleDraft[i];
      const temperatureRaw = draft.temperatureK.trim();
      const dtRaw = draft.dtSeconds.trim();
      if (temperatureRaw === '' || dtRaw === '') {
        setRunError(`сегмент ${i + 1}: заполните температуру (K) и длительность (с)`);
        return;
      }
      if (draft.reactionIds.length === 0) {
        setRunError(`сегмент ${i + 1}: выберите хотя бы одну реакцию (№89 и/или №106)`);
        return;
      }
      segments.push({
        temperatureK: Number(temperatureRaw),
        dtSeconds: Number(dtRaw),
        reactionIds: [...draft.reactionIds]
      });
    }

    // Первичная настройка передаётся ТОЛЬКО пока эксперимент не настроен:
    // пустое поле не превращается в ноль (ключ просто не передаётся,
    // адаптер назовёт отсутствующий вид), толщина пустая → NaN → явный
    // отказ адаптера, а не молчаливый ноль.
    let setup: { layerThicknessM: number; initialInventoriesMolM2: Partial<Record<KineticSpeciesKey, number>> } | undefined;
    if (!experiment) {
      const thicknessRaw = layerThicknessDraft.trim();
      const initialInventoriesMolM2: Partial<Record<KineticSpeciesKey, number>> = {};
      for (const field of KINETIC_EXPERIMENT_SPECIES_FIELDS) {
        const raw = inventoryDraft[field.key].trim();
        if (raw !== '') {
          initialInventoriesMolM2[field.key] = Number(raw);
        }
      }
      setup = {
        layerThicknessM: thicknessRaw === '' ? NaN : Number(thicknessRaw),
        initialInventoriesMolM2
      };
    }

    try {
      const nextWorld = runWorldKineticTrajectory(
        world,
        experiment ? { segments } : { segments, setup }
      );
      // Ошибка запуска не изменяет отображаемый мир: мир заменяется
      // только при полном успешном завершении траектории.
      props.onWorldReplace(nextWorld);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  const lastRun = experiment ? experiment.history[experiment.history.length - 1] ?? null : null;

  return (
    <div className="kinetic-experiment">
      <h3>Кинетический эксперимент — ограниченный механизм №89/№106</h3>
      <p className="kinetic-experiment-note">
        ⚠ Отдельный пользовательский расчётный сценарий в паспорте мира. Он не изменяет
        основной атмосферный ChemicalEvolutionState, не подключён к игровым часам и не
        моделирует перенос, диффузию, конвекцию или пополнение вещества. Начальные
        запасы вводятся пользователем явно и не извлекаются автоматически из
        атмосферного состава: радикалов O, NO, NO₂, H и HO₂ в атмосферном каталоге нет.
      </p>

      {!experiment && (
        <div className="kinetic-setup">
          <h4>Первичная настройка</h4>
          <p className="model-note">
            Все поля пустые по умолчанию: пустое поле не превращается в ноль. Для
            реакционных видов (O, NO, NO₂, H, O₂, HO₂) допустим явный 0; N₂ обязан быть
            конечным и строго положительным (третье тело механизма).
          </p>
          <div className="kinetic-setup-grid">
            <label>
              Толщина слоя, м
              <input
                type="text"
                value={layerThicknessDraft}
                onChange={(e) => setLayerThicknessDraft(e.target.value)}
                placeholder="например, 1000"
              />
            </label>
            {KINETIC_EXPERIMENT_SPECIES_FIELDS.map((field) => (
              <label key={field.key}>
                Начальный запас {field.formula}, моль/м²
                <input
                  type="text"
                  value={inventoryDraft[field.key]}
                  onChange={(e) =>
                    setInventoryDraft((draft) => ({ ...draft, [field.key]: e.target.value }))
                  }
                  placeholder="число или 0"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {experiment && (
        <div className="kinetic-status">
          <h4>Состояние эксперимента</h4>
          <div className="physics-grid">
            <div><span>Толщина слоя:</span> {formatKineticAmount(experiment.layerThicknessM)} м</div>
            <div><span>Накопленное физическое время:</span> {formatKineticAmount(experiment.elapsedSeconds)} с</div>
            <div><span>Успешных запусков:</span> {experiment.completedRuns}</div>
          </div>
          <table className="atmosphere-table">
            <thead>
              <tr>
                {KINETIC_EXPERIMENT_SPECIES_FIELDS.map((field) => (
                  <th key={field.key}>{field.formula}, моль/м²</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {KINETIC_EXPERIMENT_SPECIES_FIELDS.map((field) => (
                  <td key={field.key}>{formatKineticAmount(experiment.currentInventoriesMolM2[field.key])}</td>
                ))}
              </tr>
            </tbody>
          </table>
          {lastRun && (
            <details className="kinetic-run-details">
              <summary>Последний запуск (№{lastRun.runIndex + 1})</summary>
              <p>
                Физическое время:{' '}
                {formatKineticAmount(lastRun.startElapsedSeconds)} с → {formatKineticAmount(lastRun.endElapsedSeconds)} с
              </p>
              <table className="atmosphere-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>T, K</th>
                    <th>dt, с</th>
                    <th>Реакции</th>
                    <th>Начало, с</th>
                    <th>Конец, с</th>
                  </tr>
                </thead>
                <tbody>
                  {lastRun.segments.map((segment) => (
                    <tr key={segment.index}>
                      <td>{segment.index + 1}</td>
                      <td>{segment.temperatureK}</td>
                      <td>{formatKineticAmount(segment.dtSeconds)}</td>
                      <td>
                        {segment.reactionIds
                          .map(
                            (id) =>
                              KINETIC_EXPERIMENT_REACTIONS.find((r) => r.id === id)?.label ?? id
                          )
                          .join(', ')}
                      </td>
                      <td>{formatKineticAmount(segment.startTimeSeconds)}</td>
                      <td>{formatKineticAmount(segment.endTimeSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lastRun.warnings.length > 0 && (
                <p className="kinetic-warnings">Предупреждения: {lastRun.warnings.join('; ')}</p>
              )}
              {lastRun.assumptions.length > 0 && (
                <p className="model-note">Предпосылки результата: {lastRun.assumptions.join('; ')}</p>
              )}
            </details>
          )}
        </div>
      )}

      <div className="kinetic-schedule">
        <h4>Расписание сегментов</h4>
        <p className="model-note">
          Температурные диапазоны: №89: 200–300 K; №106: 300–400 K; совместный выбор
          №89+№106 допустим только при 300 K. Ничего не исправляется и не отключается
          автоматически: ошибка запуска будет показана с причиной из механизма.
        </p>
        {scheduleDraft.map((draft, i) => (
          <div className="kinetic-segment" key={i}>
            <span className="kinetic-segment-title">Сегмент {i + 1}</span>
            <label>
              T, K
              <input
                type="text"
                value={draft.temperatureK}
                onChange={(e) => setSegmentField(i, 'temperatureK', e.target.value)}
                placeholder="например, 250"
              />
            </label>
            <label>
              dt, с
              <input
                type="text"
                value={draft.dtSeconds}
                onChange={(e) => setSegmentField(i, 'dtSeconds', e.target.value)}
                placeholder="например, 100"
              />
            </label>
            {KINETIC_EXPERIMENT_REACTIONS.map((reaction) => (
              <label className="kinetic-reaction-option" key={reaction.id}>
                <input
                  type="checkbox"
                  checked={draft.reactionIds.includes(reaction.id)}
                  onChange={() => toggleSegmentReaction(i, reaction.id)}
                />
                {reaction.label}
              </label>
            ))}
            <button
              className="secondary"
              onClick={() => removeSegment(i)}
              disabled={scheduleDraft.length <= 1}
            >
              Удалить сегмент
            </button>
          </div>
        ))}
        <button className="secondary" onClick={addSegment}>
          Добавить сегмент
        </button>
      </div>

      {runError && <div className="kinetic-error">✖ {runError}</div>}

      <div className="kinetic-actions">
        <button className="primary" onClick={handleRun}>
          {experiment ? 'Выполнить запуск' : 'Настроить и выполнить запуск'}
        </button>
        {experiment && (
          <button className="danger" onClick={handleReset}>
            Сбросить эксперимент
          </button>
        )}
      </div>
    </div>
  );
}

// Компонент для отображения мира
function WorldDisplay(props: {
  world: GeneratedWorld | null;
  onSave: () => void;
  onClose: () => void;
  onChemicalStep?: () => void;
  onWorldReplace: (world: GeneratedWorld) => void;
}) {
  if (!props.world) return null;

  const world = props.world;
  const warningsCount = world.warnings.filter(w => w.severity === 'error').length;

  return (
    <div className="world-display">
      <div className="world-header">
        <h2>Паспорт мира</h2>
        <div className="world-actions">
          <button onClick={props.onSave} className="primary">Сохранить мир</button>
          <button onClick={props.onClose} className="secondary">Закрыть</button>
        </div>
      </div>

      <div className="world-summary">
        <h3>Краткое описание</h3>
        <p>{createShortDescription(world)}</p>
        <p><strong>Seed:</strong> {world.seed}</p>
        <p><strong>Режим:</strong> {world.mode === 'anomalous' ? 'Аномальный' : 'Реалистичный'}</p>
        <p><strong>Научный статус:</strong> {formatScientificStatus(world.scientificStatus)}</p>
        {warningsCount > 0 && (
          <p className="warning">⚠️ {warningsCount} ошибка(и) совместимости</p>
        )}
      </div>

      <div className="world-details">
        <WorldSection title="Космология" content={world.cosmology.name} />
        <WorldSection title="Эпоха" content={`${world.epoch.name} (${world.epoch.ageRange.min}-${world.epoch.ageRange.max} млрд лет)`} />
        <WorldSection title="Центральный объект" content={world.centralObject.name} />
        <WorldSection title="Небесное тело" content={world.celestialBody.name} />
        <WorldSection title="Колыбель жизни" content={world.cradle.name} />
      </div>

      <div className="world-atmosphere">
        <h3>Атмосфера</h3>
        {world.atmosphere.components.length > 0 ? (
          <table className="atmosphere-table">
            <thead>
              <tr>
                <th>Газ</th>
                <th>Формула</th>
                <th>%</th>
                <th>Примечания</th>
              </tr>
            </thead>
            <tbody>
              {world.atmosphere.components.map(comp => {
                const gas = gases.find(g => g.id === comp.gasId);
                return (
                  <tr key={comp.gasId}>
                    <td>{gas?.name || comp.gasId}</td>
                    <td>{gas?.formula || comp.gasId}</td>
                    <td>{comp.percentage.toFixed(4)}%</td>
                    <td>{comp.uncertainty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p>Атмосфера не определена</p>
        )}
        {world.atmosphere.totalPressure && (
          <p>Общее давление: {world.atmosphere.totalPressure} atm</p>
        )}
        {world.atmosphere.temperature && (
          <p>Температура: {world.atmosphere.temperature} K</p>
        )}
      </div>

      <div className="world-physics">
        <h3>Физические характеристики</h3>
        <div className="physics-grid">
          {world.physicalCharacteristics.mass && (
            <div><span>Масса:</span> {world.physicalCharacteristics.mass} масс Земли</div>
          )}
          {world.physicalCharacteristics.radius && (
            <div><span>Радиус:</span> {world.physicalCharacteristics.radius} радиусов Земли</div>
          )}
          {world.physicalCharacteristics.surfaceGravity && (
            <div><span>Гравитация:</span> {world.physicalCharacteristics.surfaceGravity}g</div>
          )}
          {world.physicalCharacteristics.surfaceTemperature && (
            <div><span>Температура:</span> {world.physicalCharacteristics.surfaceTemperature} K</div>
          )}
          {world.physicalCharacteristics.atmosphericPressure && (
            <div><span>Давление:</span> {world.physicalCharacteristics.atmosphericPressure} atm</div>
          )}
          {world.physicalCharacteristics.geologicalActivity && (
            <div><span>Геологическая активность:</span> {world.physicalCharacteristics.geologicalActivity}</div>
          )}
        </div>
      </div>

      {/* --- Этап 3: физическая модель планетарной системы --- */}

      {world.bodyPhysics && (
        <div className="world-physics">
          <h3>Физическая модель тела</h3>
          <div className="physics-grid">
            <div><span>Масса:</span> {formatPhysValue(world.bodyPhysics.massKg)} ({(world.bodyPhysics.massKg.value ?? 0).toExponential(2)} кг)</div>
            <div><span>Радиус:</span> {formatPhysValue(world.bodyPhysics.radiusM)} ({(world.bodyPhysics.radiusM.value ?? 0).toExponential(2)} м)</div>
            <div><span>Плотность:</span> {formatPhysValue(world.bodyPhysics.densityKgM3)}</div>
            <div>
              <span>Гравитация:</span> {formatPhysValue(world.bodyPhysics.surfaceGravityMs2)}
              {world.bodyPhysics.surfaceGravityInG.value !== null && ` (${world.bodyPhysics.surfaceGravityInG.value.toFixed(2)} g)`}
            </div>
            <div>
              <span>Согласованность:</span>{' '}
              {world.bodyPhysics.consistencyCheck.plausible
                ? `правдоподобная плотность (${world.bodyPhysics.consistencyCheck.note})`
                : `⚠ ${world.bodyPhysics.consistencyCheck.note}`}
            </div>
          </div>
        </div>
      )}

      {(world.centralObjectSystem || world.orbit || world.energyBudget) && (
        <div className="world-physics">
          <h3>Астрономическая система</h3>
          <div className="physics-grid">
            {world.centralObjectSystem && (
              <div><span>Структура системы:</span> {describeCentralObjectSystem(world.centralObjectSystem)}</div>
            )}
            {world.orbit && (
              <>
                <div><span>Орбита:</span> {world.orbit.orbitalBasis}</div>
                <div>
                  <span>Большая полуось:</span>{' '}
                  {world.orbit.semiMajorAxis.value !== null
                    ? `${(world.orbit.semiMajorAxis.value / 1.495978707e11).toFixed(3)} а.е. (${world.orbit.semiMajorAxis.value.toExponential(2)} м)`
                    : `неизвестно — ${world.orbit.semiMajorAxis.note ?? ''}`}
                </div>
                {world.orbit.eccentricity.value !== null && (
                  <div><span>Эксцентриситет:</span> {world.orbit.eccentricity.value.toFixed(3)}</div>
                )}
                {world.orbit.orbitalPeriod.value !== null && (
                  <div>
                    <span>Орбитальный период:</span>{' '}
                    {(world.orbit.orbitalPeriod.value / 3.15576e7).toFixed(2)} лет
                  </div>
                )}
                <div>
                  <span>Приливный захват:</span> {world.orbit.tidalLocking.value === 'possible' ? 'возможен' : world.orbit.tidalLocking.value === 'unknown' ? 'неизвестно' : 'маловероятен'}
                </div>
                <div><span>Устойчивость:</span> {world.orbit.stabilityCheck === 'not_performed' ? 'динамически не проверялась' : world.orbit.stabilityCheck}</div>
              </>
            )}
            {world.energyBudget && (
              <>
                <div><span>Падающий поток:</span> {formatPhysValue(world.energyBudget.incidentFlux)}</div>
                <div><span>Равновесная температура:</span> {formatPhysValue(world.energyBudget.equilibriumTemperature)}</div>
                <div><span>Внутреннее тепло:</span> {formatHeatLevel(world.energyBudget.internalHeatLevel)}</div>
              </>
            )}
          </div>
          {world.energyBudget && (
            <p className="model-note">ℹ {world.energyBudget.greenhouseNote}</p>
          )}
        </div>
      )}

      {world.atmospherePhysics && (
        <div className="world-atmosphere">
          <h3>Физическая модель атмосферы</h3>
          <table className="atmosphere-table">
            <thead>
              <tr>
                <th>Газ</th>
                <th>Молярная доля</th>
                <th>Парциальное давление, Па</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(world.atmospherePhysics.molarFractions).map(([gasId, fraction]) => {
                const gas = gases.find(g => g.id === gasId);
                const partial = world.atmospherePhysics?.partialPressuresPa[gasId]?.value;
                return (
                  <tr key={gasId}>
                    <td>{gas?.name || gasId}</td>
                    <td>{(fraction * 100).toFixed(4)}%</td>
                    <td>{partial !== null && partial !== undefined ? partial.toExponential(3) : 'неизвестно'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="physics-grid">
            {world.atmospherePhysics.surfacePressurePa && (
              <div><span>Общее давление:</span> {formatPhysValue(world.atmospherePhysics.surfacePressurePa)}</div>
            )}
            {world.atmospherePhysics.meanMolarMassKgMol && (
              <div><span>Средняя молярная масса:</span> {(world.atmospherePhysics.meanMolarMassKgMol.value ?? 0).toFixed(4)} кг/моль</div>
            )}
            {world.atmospherePhysics.columnMassKgM2 && (
              <div><span>Масса столба:</span> {formatPhysValue(world.atmospherePhysics.columnMassKgM2)}</div>
            )}
            {world.atmospherePhysics.columnMolM2 && (
              <div><span>Вещество столба:</span> {formatPhysValue(world.atmospherePhysics.columnMolM2)}</div>
            )}
          </div>
          <p className="model-note">ℹ {world.atmospherePhysics.idealGasNote}</p>
          <p className="model-note">⚠ {world.atmospherePhysics.fugacityNote}</p>
        </div>
      )}

      {world.phaseAnalysis && (
        <div className="world-phases">
          <h3>Фазовые состояния компонентов</h3>
          <ul>
            {world.phaseAnalysis.components.map(component => {
              const gas = gases.find(g => g.id === component.gasId);
              return (
                <li key={component.gasId}>
                  <strong>{gas?.name || component.gasId}:</strong>{' '}
                  {formatPhaseState(component.state)}
                  {component.screeningRatio !== null && component.screeningRatio !== undefined && ` (S = ${component.screeningRatio.toFixed(2)})`}
                  {component.extrapolated && ' — вне экспериментального диапазона корреляции'}
                  {` — ${component.message}`}
                </li>
              );
            })}
          </ul>
          {world.phaseAnalysis.warnings.map((warning, i) => (
            <p key={i} className="warning">⚠ {warning}</p>
          ))}
        </div>
      )}

      {world.geologyAnalysis && (
        <div className="world-physics">
          <h3>Внутреннее тепло и геология</h3>
          <div className="physics-grid">
            <div><span>Суммарный уровень:</span> {formatHeatLevel(world.geologyAnalysis.totalInternalHeat)}</div>
            <div>
              <span>Геотермальная энергия:</span>{' '}
              {world.geologyAnalysis.geothermalEnergyAvailable ? 'доступна' : 'недоступна (автоматически не добавляется)'}
            </div>
            <div><span>Остаточное тепло:</span> {formatHeatSource(world.geologyAnalysis.primordialHeat)}</div>
            <div><span>Радиогенный нагрев:</span> {formatHeatSource(world.geologyAnalysis.radiogenicHeat)}</div>
            <div><span>Приливный нагрев:</span> {formatHeatSource(world.geologyAnalysis.tidalHeat)}</div>
            <div>
              <span>Вулканизм:</span>{' '}
              {world.geologyAnalysis.volcanism === true ? 'возможен' : world.geologyAnalysis.volcanism === null ? 'неизвестно' : 'маловероятен'}
            </div>
            <div>
              <span>Гидротермальные системы:</span>{' '}
              {world.geologyAnalysis.hydrothermalSystems === true ? 'возможны' : world.geologyAnalysis.hydrothermalSystems === null ? 'неизвестно' : 'маловероятны'}
            </div>
          </div>
        </div>
      )}

      {world.chemicalState && (
        <div className="world-chemistry">
          <h3>Химическая эволюция</h3>
          <div className="physics-grid">
            <div>
              <span>Режим инвентаря:</span>{' '}
              {world.chemicalState.mode === 'column_inventory'
                ? 'моль/м² атмосферного столба'
                : 'нормированный игровой (абсолютное количество неизвестно)'}
            </div>
            <div><span>Модельное время:</span> {world.chemicalState.modelTimeYears.toExponential(2)} лет</div>
            <div><span>Длительность шага:</span> {world.chemicalState.stepDurationYears.toExponential(2)} лет (игровое допущение)</div>
            {world.chemicalState.surfacePressurePa !== null && (
              <div><span>Давление:</span> {world.chemicalState.surfacePressurePa.toExponential(4)} Па</div>
            )}
            <div>
              <span>Баланс O₂ (за последний шаг):</span> производство {world.chemicalState.oxygenBalance.production.toExponential(2)},
              потребление {world.chemicalState.oxygenBalance.consumption.toExponential(2)},
              итог {world.chemicalState.oxygenBalance.net.toExponential(2)}{' '}
              {world.chemicalState.mode === 'column_inventory' ? 'моль/м²' : 'нормированные игровые единицы'}
            </div>
          </div>
          <p className="model-note">ℹ {world.chemicalState.unitsNote}</p>
          {world.chemicalState.history.length > 0 && (
            <details>
              <summary>История шагов ({world.chemicalState.history.length})</summary>
              <ul>
                {world.chemicalState.history.map((record, i) => (
                  <li key={i}>
                    {record.reactionId}: {record.applied ? 'выполнена' : `не выполнена (${record.reason})`}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {props.onChemicalStep && (
            <button onClick={props.onChemicalStep} className="secondary">
              Сделать шаг химической эволюции
            </button>
          )}
        </div>
      )}

      <KineticExperimentSection world={world} onWorldReplace={props.onWorldReplace} />

      {world.warnings.length > 0 && (
        <div className="world-warnings">
          <h3>Предупреждения</h3>
          <ul>
            {world.warnings.map(warning => (
              <li key={warning.id} className={`warning-${warning.severity}`}>
                <strong>{warning.severity.toUpperCase()}:</strong> {warning.message}
                <ul>
                  {warning.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="world-causal">
        <h3>Причинно-следственная цепочка</h3>
        <p>{world.causalChain.cosmology}</p>
        <p>{world.causalChain.epoch}</p>
        <p>{world.causalChain.centralObject}</p>
        <p>{world.causalChain.celestialBody}</p>
        <p>{world.causalChain.cradle}</p>
      </div>
    </div>
  );
}

// Вспомогательный компонент для секций
function WorldSection(props: { title: string; content: string }) {
  return (
    <div className="world-section">
      <span className="section-title">{props.title}:</span>
      <span className="section-content">{props.content}</span>
    </div>
  );
}

// Компонент для истории генераций
function HistoryPanel(props: {
  worlds: SavedWorld[];
  onLoad: (world: SavedWorld) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="history-panel">
      <h2>История генераций</h2>
      
      {props.worlds.length === 0 ? (
        <p>Нет сохраненных миров</p>
      ) : (
        <>
          <div className="history-actions">
            <button onClick={props.onClear} className="danger">
              Очистить историю
            </button>
          </div>
          <div className="history-list">
            {props.worlds.map(world => (
              <div key={world.id} className="history-item">
                <div className="history-info">
                  <strong>{createShortDescription(world)}</strong>
                  <div className="history-meta">
                    <span>Seed: {world.seed}</span>
                    <span>Создан: {new Date(world.createdAt).toLocaleString('ru-RU')}</span>
                  </div>
                </div>
                <div className="history-actions">
                  <button onClick={() => props.onLoad(world)} className="primary">
                    Загрузить
                  </button>
                  <button onClick={() => props.onDelete(world.id)} className="danger">
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Компонент для экспорта
function ExportPanel(props: {
  world: GeneratedWorld | null;
}) {
  const [exportFormat, setExportFormat] = useState<'json' | 'markdown'>('json');
  const [exportText, setExportText] = useState('');

  useEffect(() => {
    if (props.world) {
      if (exportFormat === 'json') {
        setExportText(JSON.stringify(props.world, null, 2));
      } else {
        // Для markdown используем упрощенную версию
        const lines = [
          `# Мир: ${props.world.seed}`,
          ``,
          `**Seed:** ${props.world.seed}`,
          `**Режим:** ${props.world.mode}`,
          `**Космология:** ${props.world.cosmology.name}`,
          `**Эпоха:** ${props.world.epoch.name}`,
          `**Центральный объект:** ${props.world.centralObject.name}`,
          `**Небесное тело:** ${props.world.celestialBody.name}`,
          `**Колыбель:** ${props.world.cradle.name}`
        ];
        setExportText(lines.join('\n'));
      }
    }
  }, [props.world, exportFormat]);

  const handleCopy = () => {
    navigator.clipboard.writeText(exportText);
  };

  const handleDownload = () => {
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `world_${props.world?.seed || 'unknown'}.${exportFormat}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!props.world) return null;

  return (
    <div className="export-panel">
      <h2>Экспорт мира</h2>
      
      <div className="export-format">
        <label>
          <input
            type="radio"
            checked={exportFormat === 'json'}
            onChange={() => setExportFormat('json')}
          />
          JSON
        </label>
        <label>
          <input
            type="radio"
            checked={exportFormat === 'markdown'}
            onChange={() => setExportFormat('markdown')}
          />
          Markdown
        </label>
      </div>

      <div className="export-text">
        <textarea value={exportText} readOnly rows={10} />
      </div>

      <div className="export-actions">
        <button onClick={handleCopy} className="primary">Копировать</button>
        <button onClick={handleDownload} className="secondary">Скачать</button>
      </div>
    </div>
  );
}

// Форматирование научного статуса
function formatScientificStatus(status: string): string {
  const map: Record<string, string> = {
    'established_fact': 'Установленный факт',
    'physically_plausible': 'Физически правдоподобно',
    'hypothetical': 'Гипотетически',
    'impossible_in_model': 'Невозможно в модели',
    'game_assumption': 'Игровое допущение',
    'anomalous_rule': 'Аномальное правило'
  };
  return map[status] || status;
}

// ===== Помощники отображения физической модели (этап 3) =====

// Русская метка степени научной достоверности значения
function formatConfidence(confidence: ScientificConfidence): string {
  const map: Record<ScientificConfidence, string> = {
    'established': 'установлено',
    'derived': 'рассчитано',
    'estimated': 'оценка',
    'hypothetical': 'гипотеза',
    'game_assumption': 'игровое допущение',
    'unknown': 'неизвестно'
  };
  return map[confidence] ?? confidence;
}

// Форматирование физического значения с указанием достоверности:
// пользователь видит, где известная физика, а где модельное предположение.
function formatPhysValue(value: PhysValue): string {
  if (value.value === null) {
    return `неизвестно — ${value.note ?? 'данных недостаточно'}`;
  }
  return `${value.value.toExponential(3)} ${value.unit} [${formatConfidence(value.confidence)}]`;
}

// Русская метка фазового состояния компонента
function formatPhaseState(state: string): string {
  const map: Record<string, string> = {
    'gas': 'газ',
    'potentially_condensing': 'потенциальная конденсация',
    'potential_solid_deposition': 'возможно выпадение твёрдой фазы',
    'no_condensation_above_critical': 'выше критической температуры',
    'unknown': 'неизвестно'
  };
  return map[state] ?? state;
}

// Русская метка уровня внутреннего тепла
function formatHeatLevel(level: string): string {
  const map: Record<string, string> = {
    'high': 'высокий',
    'moderate': 'умеренный',
    'low': 'низкий',
    'none': 'отсутствует',
    'unknown': 'неизвестно'
  };
  return map[level] ?? level;
}

// Описание отдельного источника внутреннего тепла
function formatHeatSource(source: { level: string | null; status: string; note: string }): string {
  if (source.level === null) {
    return `${source.status === 'potential' ? 'возможен, не оценён' : 'не оценён'} — ${source.note}`;
  }
  return `${formatHeatLevel(source.level)} — ${source.note}`;
}

// Краткое описание структурированной системы центрального объекта
function describeCentralObjectSystem(system: NonNullable<GeneratedWorld['centralObjectSystem']>): string {
  switch (system.kind) {
    case 'star':
      return `звезда спектрального класса ${system.spectralClass} (масса ${(system.massKg.range?.min ?? 0).toExponential(1)}–${(system.massKg.range?.max ?? 0).toExponential(1)} кг; время жизни класса ${system.typicalLifetimeGyr.min}–${system.typicalLifetimeGyr.max} млрд лет)`;
    case 'compact_remnant':
      return `компактный остаток (${system.remnantType === 'white_dwarf' ? 'белый карлик' : system.remnantType === 'neutron_star' ? 'нейтронная звезда' : 'чёрная дыра'})${system.accretionDependent ? '; мощное излучение зависит от аккреции и не гарантировано' : ''}`;
    case 'substellar':
      return `субзвёздный объект (коричневый карлик)${system.hasInternalHeat ? ' с внутренним тепловыделением' : ''}`;
    case 'gas_giant_system':
      return `одинокий газовый гигант${system.moonSystem.possible ? ' с возможной системой спутников' : ''}; внутреннее тепловыделение неизвестно`;
    case 'jet_system':
      return 'релятивистский джет — направленный высокоэнергетический поток, связанный с компактным объектом активного ядра; это НЕ обычный гравитационный центр системы';
  }
}

// ============================================
// ОСНОВНОЙ КОМПОНЕНТ
// ============================================

function App() {
  const [currentWorld, setCurrentWorld] = useState<GeneratedWorld | null>(null);
  const [savedWorlds, setSavedWorlds] = useState<SavedWorld[]>([]);
  const [settings, setSettings] = useState<GenerationSettings>({
    seed: generateRandomSeed(),
    mode: 'realistic',
    weights: {
      cosmology: {},
      epoch: {},
      centralObject: {},
      celestialBody: {},
      cradle: {}
    },
    fixedCategories: {},
    enableChemicalEvolution: false,
    chemicalEvolutionSteps: 1
  });
  const [activeTab, setActiveTab] = useState<'generator' | 'history' | 'export'>('generator');
  const [multipleWorlds, setMultipleWorlds] = useState<GeneratedWorld[]>([]);

  // Загрузка сохраненных миров и настроек
  useEffect(() => {
    const worlds = getAllWorlds();
    setSavedWorlds(worlds);
    
    const savedSettings = getSettings();
    if (savedSettings) {
      setSettings(savedSettings);
    }
    
    const lastSeed = getLastSeed();
    if (lastSeed) {
      setSettings(prev => ({ ...prev, seed: lastSeed }));
    }
  }, []);

  // Сохранение мира
  const handleSaveWorld = () => {
    if (!currentWorld) return;
    
    const saved = saveWorld(currentWorld, settings);
    setSavedWorlds([saved, ...savedWorlds]);
  };

  // Загрузка мира из истории
  const handleLoadWorld = (world: SavedWorld) => {
    setCurrentWorld(world);
    setActiveTab('generator');
  };

  // Удаление мира из истории
  const handleDeleteWorld = (id: string) => {
    deleteWorld(id);
    setSavedWorlds(savedWorlds.filter(w => w.id !== id));
  };

  // Очистка истории
  const handleClearHistory = () => {
    if (window.confirm('Вы уверены, что хотите удалить всю историю?')) {
      clearAllWorlds();
      setSavedWorlds([]);
    }
  };

  // Генерация мира
  const handleGenerate = (world: GeneratedWorld) => {
    setCurrentWorld(world);
    setMultipleWorlds([]);
  };

  // Генерация нескольких миров
  const handleGenerateMultiple = (worlds: GeneratedWorld[]) => {
    setMultipleWorlds(worlds);
    setCurrentWorld(null);
  };

  // Шаг химической эволюции (этап 3): стехиометрический движок
  // применяет реакции каталога с контролем элементного баланса
  // и лимитирующего реагента.
  const handleChemicalStep = () => {
    if (!currentWorld) return;
    const result = runChemicalEvolutionStep(currentWorld);
    setCurrentWorld(result.world);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Эволюционные Войны</h1>
        <p className="subtitle">Генератор условий мира</p>
      </header>

      <nav className="app-nav">
        <button
          className={activeTab === 'generator' ? 'active' : ''}
          onClick={() => setActiveTab('generator')}
        >
          Генератор
        </button>
        <button
          className={activeTab === 'history' ? 'active' : ''}
          onClick={() => setActiveTab('history')}
        >
          История ({savedWorlds.length})
        </button>
        {currentWorld && (
          <button
            className={activeTab === 'export' ? 'active' : ''}
            onClick={() => setActiveTab('export')}
          >
            Экспорт
          </button>
        )}
      </nav>

      <main className="app-main">
        {activeTab === 'generator' && (
          <>
            <GeneratorPanel
              onGenerate={handleGenerate}
              onGenerateMultiple={handleGenerateMultiple}
              settings={settings}
              onSettingsChange={setSettings}
            />
            
            {multipleWorlds.length > 0 && (
              <div className="multiple-worlds">
                <h3>Сгенерированные миры ({multipleWorlds.length})</h3>
                <div className="worlds-grid">
                  {multipleWorlds.map(world => (
                    <div
                      key={world.id}
                      className="world-card"
                      onClick={() => setCurrentWorld(world)}
                    >
                      <h4>{createShortDescription(world)}</h4>
                      <p>Seed: {world.seed}</p>
                      <p className={world.warnings.some(w => w.severity === 'error') ? 'error' : ''}>
                        {world.warnings.length} предупреждений
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {currentWorld && (
              <WorldDisplay
                world={currentWorld}
                onSave={handleSaveWorld}
                onClose={() => setCurrentWorld(null)}
                onChemicalStep={handleChemicalStep}
                onWorldReplace={setCurrentWorld}
              />
            )}
          </>
        )}

        {activeTab === 'history' && (
          <HistoryPanel
            worlds={savedWorlds}
            onLoad={handleLoadWorld}
            onDelete={handleDeleteWorld}
            onClear={handleClearHistory}
          />
        )}

        {activeTab === 'export' && (
          <ExportPanel world={currentWorld} />
        )}
      </main>

      <footer className="app-footer">
        <p>Эволюционные Войны - Генератор условий мира v0.3.0 (этап 3: физическая модель)</p>
      </footer>
    </div>
  );
}

export default App;

