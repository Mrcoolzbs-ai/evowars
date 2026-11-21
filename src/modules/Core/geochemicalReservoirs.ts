// ============================================
// GEOCHEMICAL RESERVOIRS - типизированный справочник геохимических резервуаров (Stage 4.9a.1)
// ============================================
//
// КОРРЕКТИРУЮЩАЯ РЕВИЗИЯ Stage 4.9a.1 (проблема B).
//
// Проблема предыдущей ревизии: геохимический каталог предполагал
// резервуары «atmosphere / ocean / crust / mantle», тогда как
// существующий адаптер ChemicalEvolution создаёт резервуары ядра
// «atmosphere / liquid-surface / subsurface-liquid / solid-deposits»
// (CHEMICAL_RESERVOIR_IDS в Core/adapters.ts). Молчаливое отождествление
// «liquid-surface = ocean», «solid-deposits = crust», «subsurface-liquid =
// mantle» физически некорректно: это РАЗНЫЕ физические объекты
// (поверхностный жидкий слой не обязан быть океаном с биогеохимическим
// циклом; твёрдые отложения — не вся кора; подповерхностная жидкость —
// не мантия).
//
// РЕШЕНИЕ (этот модуль):
// - ЕДИНЫЙ типизированный справочник геохимических резервуаров
//   GEOCHEMICAL_RESERVOIR_DICTIONARY: стабильные id и физические роли;
//   у КАЖДОГО резервуара справочника поле legacyReservoirId = null —
//   автоматического соответствия с легаси-резервуарами НЕ существует,
//   соответствие устанавливается ТОЛЬКО явным правилом с обоснованием;
// - ЯВНЫЙ построитель резервуаров на базе ReservoirRecord ядра
//   (createGeochemicalReservoirs): резервуар создаётся ТОЛЬКО при
//   предоставленных явных физических данных (инвентарь); при отсутствии
//   данных результат содержит диагностику и резервуар НЕ создаётся —
//   «пустых» резервуаров-заглушек нет, неисполнимость остаётся
//   неисполнимостью;
// - запасы легаси-резервуаров НЕ копируются в геохимические резервуары
//   «как есть»: правило преобразования (площадь, доля, партиционирование)
//   обязано быть передано явно; автоматического перевода полного запаса
//   в столбовой нет;
// - классификация легаси-резервуаров (classifyLegacyReservoirCorrespondence)
//   отвечает на вопрос «какой геохимический резервуар соответствует
//   легаси-резервуару» ЧЕСТНО: только там, где это один и тот же
//   физический объект, — подтверждение; в остальных случаях — явное
//   «требуется обоснование» или «геохимического аналога нет»;
// - существующие данные CoreWorldState не теряются: справочник ничего
//   не удаляет и не переименовывает, он ДОБАВЛЯЕТ отдельное пространство
//   имён геохимических резервуаров; при подключении легаси-инвентарей
//   совместимость основания (basis) проверяется явно.
//
// Основание инвентаря: 'column_amount' (mol/m²) — ТОЛЬКО для
// действительно столбовых количеств (столб атмосферы, столб океана,
// столб породы заданной горизонтальной проекции). Перевод полных
// запасов (basis 'amount') в столбовые требует площади и НЕ выполняется
// автоматически.

import { createReservoir, setMaterialInventory, validateMaterialInventory } from './reservoir';
import type { ReservoirRecord } from './reservoir';

// ============================================
// 1. СПРАВОЧНИК ГЕОХИМИЧЕСКИХ РЕЗЕРВУАРОВ
// ============================================

/**
 * Стабильные идентификаторы геохимических резервуаров Stage 4.9.
 * Это ОТДЕЛЬНОЕ пространство имён от легаси-резервуаров ядра
 * ('atmosphere' из адаптера химии совпадает по смыслу атмосферного
 * столба, но соответствие резервуаров liquid-surface/solid-deposits/
 * subsurface-liquid устанавливается ТОЛЬКО явными правилами).
 */
export type GeochemicalReservoirId = 'atmosphere' | 'ocean' | 'crust' | 'mantle';

/** Описание резервуара справочника (данные, не логика). */
export interface GeochemicalReservoirDefinition {
  /** Стабильный идентификатор резервуара. */
  readonly id: GeochemicalReservoirId;
  /** Физическая роль резервуара в геохимических циклах. */
  readonly role: string;
  /** Человекочитаемое физическое описание. */
  readonly physicalDescription: string;
  /** Единственное основание инвентаря, совместимое с конвенцией mol/m². */
  readonly inventoryBasis: 'column_amount';
  /**
   * АВТОМАТИЧЕСКОГО соответствия легаси-резервуару НЕТ (всегда null):
   * соответствие устанавливается только явным правилом с обоснованием
   * (см. classifyLegacyReservoirCorrespondence / buildExplicitReservoirMapping).
   */
  readonly legacyReservoirId: null;
  /** Ограничения справочника (что описание НЕ утверждает). */
  readonly note: string;
}

/** Канонический справочник геохимических резервуаров углеродного цикла. */
export const GEOCHEMICAL_RESERVOIR_DICTIONARY: readonly GeochemicalReservoirDefinition[] = [
  {
    id: 'atmosphere',
    role: 'атмосферный резервуар газов',
    physicalDescription: 'столб атмосферы: CO2 и другие газы в mol/m² (столбовая конвенция внешнего геохимического контракта)',
    inventoryBasis: 'column_amount',
    legacyReservoirId: null,
    note: 'атмосферный столб легаси-химии — тот же физический объект, но совместимость оснований инвентаря проверяется отдельно; автоматического копирования запасов нет'
  },
  {
    id: 'ocean',
    role: 'поверхностный океан (растворённые вещества)',
    physicalDescription: 'поверхностный океан: растворённый неорганический (co2_aq) и органический (c_org) углерод в mol/m² морского столба',
    inventoryBasis: 'column_amount',
    legacyReservoirId: null,
    note: 'НЕ отождествляется автоматически с легаси liquid-surface: подповерхностные жидкости и рассолы — не океан с биогеохимическим циклом; соответствие — только явное правило с обоснованием'
  },
  {
    id: 'crust',
    role: 'земная кора (осадочные и породные запасы)',
    physicalDescription: 'приповерхностная кора: карбонаты (caco3) и захоронённый органический углерод (c_org) в mol/m² горизонтальной проекции',
    inventoryBasis: 'column_amount',
    legacyReservoirId: null,
    note: 'НЕ отождествляется автоматически с легаси solid-deposits: твёрдые отложения — частный случай запасов коры, а не вся кора; соответствие — только явное правило с обоснованием'
  },
  {
    id: 'mantle',
    role: 'мантия (глубинный углерод)',
    physicalDescription: 'мантия планеты: глубинный углерод в mol/m² (замыкает цикл субдукцией/дегазацией)',
    inventoryBasis: 'column_amount',
    legacyReservoirId: null,
    note: 'геохимического аналога среди легаси-резервуаров НЕТ: легаси subsurface-liquid — подповерхностная жидкость, а не мантия; резервуар создаётся только из явно предоставленных данных'
  }
] as const;

/** Список стабильных id справочника (для диагностики и валидации). */
export const GEOCHEMICAL_RESERVOIR_IDS: readonly GeochemicalReservoirId[] =
  GEOCHEMICAL_RESERVOIR_DICTIONARY.map((d) => d.id);

/**
 * Runtime-валидация справочника: уникальность id, непустые роли/описания,
 * обязательная столбовая основа, обязательное ЯВНОЕ отсутствие легаси-id.
 */
export function validateGeochemicalReservoirDictionary(catalog: readonly unknown[] = GEOCHEMICAL_RESERVOIR_DICTIONARY): string[] {
  const errors: string[] = [];
  const known: GeochemicalReservoirId[] = ['atmosphere', 'ocean', 'crust', 'mantle'];
  const seen = new Set<string>();
  catalog.forEach((entry, index) => {
    const at = `запись справочника #${index}: `;
    if (typeof entry !== 'object' || entry === null) {
      errors.push(at + 'запись должна быть объектом');
      return;
    }
    const d = entry as Record<string, unknown>;
    if (typeof d.id !== 'string' || d.id.trim() === '') {
      errors.push(at + 'id резервуара должен быть непустой строкой');
    } else {
      if (seen.has(d.id)) errors.push(at + `дубликат идентификатора резервуара «${d.id}» в справочнике`);
      if (!known.includes(d.id as GeochemicalReservoirId)) {
        errors.push(at + `неизвестный id «${d.id}» вне стабильного набора (${known.join(', ')})`);
      }
      seen.add(d.id);
    }
    if (typeof d.role !== 'string' || d.role.trim() === '') errors.push(at + 'роль резервуара обязательна');
    if (typeof d.physicalDescription !== 'string' || d.physicalDescription.trim() === '') {
      errors.push(at + 'физическое описание резервуара обязательно');
    }
    if (d.inventoryBasis !== 'column_amount') {
      errors.push(at + `bases инвентаря должен быть «column_amount» (геохимическая конвенция mol/m²), получено «${String(d.inventoryBasis)}»`);
    }
    if (d.legacyReservoirId !== null) {
      errors.push(at + 'автоматическое соответствие легаси-резервуару запрещено: legacyReservoirId обязан быть null');
    }
  });
  return errors;
}

// ============================================
// 2. КЛАССИФИКАЦИЯ ЛЕГАСИ-РЕЗЕРВУАРОВ (без подмен)
// ============================================

export type GeochemicalLegacyCorrespondenceStatus =
  | 'confirmed_same_column'
  | 'candidate_requires_justification'
  | 'no_geochemical_counterpart';

export interface GeochemicalLegacyReservoirCorrespondence {
  /** Легаси-идентификатор (CHEMICAL_RESERVOIR_IDS / прочие). */
  readonly legacyReservoirId: string;
  /**
   * Геохимический резервуар, которому легаси-резервуар СООТВЕТСТВУЕТ.
   * НЕ null только там, где это один и тот же физический объект,
   * подтверждаемый без дополнительных предположений (atmosphere ↔ atmosphere).
   * Во всех остальных случаях — null: утверждение соответствия требует
   * ЯВНОГО правила с обоснованием.
   */
  readonly geochemicalReservoirId: GeochemicalReservoirId | null;
  /** Статус соответствия (см. тип). */
  readonly status: GeochemicalLegacyCorrespondenceStatus;
  /** Обоснование или причина отказа от отождествления. */
  readonly justification: string;
}

/**
 * Классификация легаси-резервуара против геохимического справочника.
 * Ключевое свойство: функции НЕ подменяют физические объекты.
 * - 'atmosphere' → 'atmosphere' (один и тот же атмосферный столб);
 * - 'liquid-surface' → только КАНДИДАТ 'ocean' со статусом
 *   candidate_requires_justification (возможно, это океан, а возможно
 *   подземные рассолы, лава или углеводородные озёра — решение за явным правилом);
 * - 'solid-deposits' → только КАНДИДАТ 'crust' со статусом
 *   candidate_requires_justification (твёрдые отложения — НЕ вся кора);
 * - 'subsurface-liquid' → геохимического аналога НЕТ (это НЕ мантия и
 *   не обязательно океан);
 * - неизвестный id → no_geochemical_counterpart.
 */
export function classifyLegacyReservoirCorrespondence(legacyReservoirId: string): GeochemicalLegacyReservoirCorrespondence {
  switch (legacyReservoirId) {
    case 'atmosphere':
      return {
        legacyReservoirId,
        geochemicalReservoirId: 'atmosphere',
        status: 'confirmed_same_column',
        justification: 'легаси-резервуар «atmosphere» и геохимический резервуар «atmosphere» описывают один и тот же физический объект — столб атмосферы; совместимость оснований инвентаря (column_amount против game_normalized) проверяется отдельно'
      };
    case 'liquid-surface':
      return {
        legacyReservoirId,
        geochemicalReservoirId: null,
        status: 'candidate_requires_justification',
        justification: 'легаси «liquid-surface» — ПОТЕНЦИАЛЬНЫЙ кандидат в геохимический «ocean», но автоматическое отождествление запрещено: поверхностная жидкость может быть рассолом/лавой/углеводородным озером; соответствие устанавливается только явным правилом с физическим обоснованием'
      };
    case 'solid-deposits':
      return {
        legacyReservoirId,
        geochemicalReservoirId: null,
        status: 'candidate_requires_justification',
        justification: 'легаси «solid-deposits» — ПОТЕНЦИАЛЬНЫЙ кандидат в геохимический «crust», но автоматическое отождествление «отложения = кора» запрещено: отложения — часть запасов коры, а не вся кора; соответствие устанавливается только явным правилом с обоснованием'
      };
    case 'subsurface-liquid':
      return {
        legacyReservoirId,
        geochemicalReservoirId: null,
        status: 'no_geochemical_counterpart',
        justification: 'легаси «subsurface-liquid» (подповерхностная жидкость) НЕ является мантией и не обязан являться океаном: геохимического аналога в справочнике нет (мантийный резервуар «mantle» строится только из явно предоставленных данных о глубинном углероде)'
      };
    default:
      return {
        legacyReservoirId,
        geochemicalReservoirId: null,
        status: 'no_geochemical_counterpart',
        justification: `легаси-резервуар «${legacyReservoirId}» не имеет геохимического аналога в справочнике (${GEOCHEMICAL_RESERVOIR_IDS.join(', ')})`
      };
  }
}

// ============================================
// 3. ЯВНОЕ ПРАВИЛО СООТВЕТСТВИЯ (требует обоснования)
// ============================================

export interface GeochemicalReservoirMappingEntry {
  /** Геохимический резервуар. */
  readonly geochemicalReservoirId: GeochemicalReservoirId;
  /** Резервуар ядра/легаси, к которому он подключается. */
  readonly coreReservoirId: string;
  /**
   * Физическое обоснование соответствия (обязательно): почему резервуар
   * ядра соответствует именно этому геохимическому резервуару.
   */
  readonly justification: string;
}

export interface GeochemicalReservoirMappingResult {
  /** Маппинг «геохимический id → резервуар ядра» (только валидные записи). */
  readonly mapping: Record<string, string>;
  /** Диагностические проблемы (пустой список = маппинг принят). */
  readonly issues: readonly string[];
}

/**
 * Явное правило соответствия геохимических и резервуаров ядра.
 * Без обоснования запись отклоняется (fail-closed): пустая строка —
 * не обоснование. Записи с неизвестным геохимическим id, дубликаты
 * геохимических id и расщепление одного резервуара ядра между двумя
 * геохимическими резервуарами (без партиционирования) отклоняются.
 */
export function buildExplicitReservoirMapping(entries: readonly GeochemicalReservoirMappingEntry[]): GeochemicalReservoirMappingResult {
  const issues: string[] = [];
  const mapping: Record<string, string> = {};
  const seenGeo = new Set<string>();
  const geoByCore = new Map<string, string[]>();
  for (const entry of entries ?? []) {
    if (!GEOCHEMICAL_RESERVOIR_IDS.includes(entry.geochemicalReservoirId)) {
      issues.push(`неизвестный геохимический резервуар «${String((entry as { geochemicalReservoirId?: unknown }).geochemicalReservoirId)}» (стабильные id: ${GEOCHEMICAL_RESERVOIR_IDS.join(', ')})`);
      continue;
    }
    if (typeof entry.coreReservoirId !== 'string' || entry.coreReservoirId.trim() === '') {
      issues.push(`резервуар ядра для геохимического «${entry.geochemicalReservoirId}» должен быть непустой строкой`);
      continue;
    }
    if (typeof entry.justification !== 'string' || entry.justification.trim() === '') {
      issues.push(`соответствие «${entry.geochemicalReservoirId}» → «${entry.coreReservoirId}» требует непустого физического обоснования`);
      continue;
    }
    if (seenGeo.has(entry.geochemicalReservoirId)) {
      issues.push(`дубликат геохимического резервуара «${entry.geochemicalReservoirId}» в правиле соответствия`);
      continue;
    }
    seenGeo.add(entry.geochemicalReservoirId);
    mapping[entry.geochemicalReservoirId] = entry.coreReservoirId;
    const list = geoByCore.get(entry.coreReservoirId) ?? [];
    list.push(entry.geochemicalReservoirId);
    geoByCore.set(entry.coreReservoirId, list);
  }
  for (const [coreReservoirId, geoList] of geoByCore) {
    if (geoList.length > 1) {
      issues.push(`резервуар ядра «${coreReservoirId}» заявлен одновременно для ${geoList.length} геохимических резервуаров (${geoList.join(', ')}): расщепление одного столба между резервуарами без явного правила партиционирования запрещено`);
    }
  }
  return { mapping, issues };
}

// ============================================
// 4. ЯВНЫЙ ПОСТРОИТЕЛЬ ГЕОХИМИЧЕСКИХ РЕЗЕРВУАРОВ
// ============================================

/** Явные данные построения одного резервуара. */
export interface GeochemicalReservoirInput {
  /** Идентификатор из справочника. */
  readonly id: GeochemicalReservoirId;
  /**
   * Явный материальный инвентарь (speciesId → mol/m²) в основании
   * column_amount. Отсутствие (null/undefined/пусто) НЕ означает
   * нулевой или «типа пустой» инвентарь: резервуар без физических
   * данных НЕ создаётся — отсутствие данных остаётся отсутствием.
   */
  readonly inventoryEntries?: Record<string, number> | null;
  /** kind создаваемого ReservoirRecord (свободная метка физического типа). */
  readonly reservoirKind?: string;
  /** Явная причина пропуска (когда данных нет, но факт известен). */
  readonly skipReason?: string;
  /** Привязка к телу мира (опционально). */
  readonly bodyId?: string;
}

export interface GeochemicalReservoirBuildResult {
  /** Построенные резервуары (id → ReservoirRecord) — ТОЛЬКО с явными данными. */
  readonly reservoirs: Record<string, ReservoirRecord>;
  /** Созданные резервуары (id). */
  readonly created: readonly string[];
  /** НЕ созданные резервуары с причина (данных не было; «пуст» нельзя утверждать). */
  readonly skipped: readonly { readonly id: GeochemicalReservoirId; readonly reason: string }[];
  /** Диагностические проблемы (неизвестные id, повреждённые инвентари). */
  readonly issues: readonly string[];
}

/**
 * Построить геохимические резервуары ТОЛЬКО из явно предоставленных
 * физических данных (контракт ReservoirRecord ядра; вторая система
 * резервуаров не создаётся — создаётся тот же ReservoirRecord).
 *
 - отсутствующий/пустой инвентарь → резервуар НЕ создаётся: фиксируется
   диагностика (skipReason или причина по умолчанию), отсутствие данных
   не подменяется нулевым или пустым резервуаром;
 - повреждённый инвентарь (NaN, ∞, отрицательные) → issue (диагностика
   канонической валидации ядра), резервуар НЕ создаётся;
 - неизвестный id → issue, создание отклоняется;
 - существующие данные CoreWorldState этим построителем НЕ трогаются:
   он возвращает НОВЫЕ записи, подключение — задача вызывающего кода.
 */
export function createGeochemicalReservoirs(inputs: readonly GeochemicalReservoirInput[]): GeochemicalReservoirBuildResult {
  const reservoirs: Record<string, ReservoirRecord> = {};
  const created: string[] = [];
  const skipped: { id: GeochemicalReservoirId; reason: string }[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const input of inputs ?? []) {
    if (!GEOCHEMICAL_RESERVOIR_IDS.includes(input.id)) {
      issues.push(`неизвестный геохимический резервуар «${String(input.id)}» (стабильные id: ${GEOCHEMICAL_RESERVOIR_IDS.join(', ')}): создание отклонено`);
      continue;
    }
    if (seen.has(input.id)) {
      issues.push(`дубликат геохимического резервуара «${input.id}» в построителе`);
      continue;
    }
    seen.add(input.id);
    const entries = input.inventoryEntries;
    if (entries === undefined || entries === null || Object.keys(entries).length === 0) {
      skipped.push({
        id: input.id,
        reason:
          input.skipReason ??
          `физические исходные данные инвентаря не предоставлены: резервуар «${input.id}» НЕ создан (отсутствие данных не подменяется нулевым или пустым резервуаром)`
      });
      continue;
    }
    // Явная проверка чисел до передачи в ядро: сообщение построителя
    // конкретнее общего валидатора инвентаря.
    let inputIssues = 0;
    for (const [speciesId, amount] of Object.entries(entries)) {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        issues.push(`резервуар «${input.id}»: количество вида «${speciesId}» должно быть конечным неотрицательным числом, получено ${String(amount)}`);
        inputIssues++;
      }
    }
    if (inputIssues > 0) continue;
    try {
      const reservoir = setMaterialInventory(
        createReservoir(input.id, input.reservoirKind ?? 'geochemical_column', input.bodyId !== undefined ? { bodyId: input.bodyId } : undefined),
        'column_amount',
        { ...entries }
      );
      const validation = validateMaterialInventory(reservoir.material!);
      if (!validation.valid) {
        issues.push(`резервуар «${input.id}»: инвентарь не проходит каноническую валидацию ядра: ${validation.errors.join('; ')}`);
        continue;
      }
      reservoirs[input.id] = reservoir;
      created.push(input.id);
    } catch (e) {
      issues.push(`резервуар «${input.id}»: построение не выполнено: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { reservoirs, created, skipped, issues };
}

// ============================================
// 5. СОВМЕСТИМОСТЬ ОСНОВАНИЯ ИНВЕНТАРЯ
// ============================================

/**
 * Совместимость резервуара ядра с геохимической конвенцией mol/m²:
 * материальный инвентарь на основании column_amount обязателен для
 * исполнения геохимических потоков. Резервуары с basis 'amount'
 * (полные запасы) или 'arbitrary_units' (нормированные игровые) для
 * геохимии НЕсовместимы: автоматический пересчёт запрещён.
 */
export function geochemicalReservoirCompatibilityIssues(reservoir: ReservoirRecord | undefined): string[] {
  if (!reservoir) {
    return ['резервуар не существует'];
  }
  const issues: string[] = [];
  if (!reservoir.material) {
    issues.push(`резервуар «${reservoir.id}» не содержит материального инвентаря: геохимический поток не может быть исполнен (инвентарь не создаётся молча)`);
    return issues;
  }
  if (reservoir.material.basis !== 'column_amount') {
    issues.push(`резервуар «${reservoir.id}» хранит инвентарь в основании «${reservoir.material.basis}», а геохимическая конвенция — «column_amount» (mol/m²): автоматический пересчёт полных запасов и игровых единиц не выполняется`);
  }
  return issues;
}
