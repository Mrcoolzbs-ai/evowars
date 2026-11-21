// ============================================
// DATA — КАТАЛОГ EOS КОНДЕНСИРОВАННЫХ МАТЕРИАЛОВ ПЛАНЕТНЫХ НЕДР
// (Stage 4.7.1)
// ============================================
//
// Контракт подэтапа — ТОЛЬКО данные, их per-parameter provenance,
// runtime-валидация и fail-closed lookup. Формулы BM3, прямая и обратная
// задачи — в Core/condensedMatterEos.ts; этот каталог к ним привязывается,
// ни формулы BM3, ни решатели сам не содержит.
//
//ulled СКОП ЭТОГО КАТАЛОГА — КОНДЕНСИРОВАННЫЕ ФАЗЫ (solid, liquid):
// - каталог газов Peng–Robinson (Data/eosParameters.ts, Stage 4.4.4.1)
//   НЕ переиспользуется и НЕ расширяется: это несопоставимые модели для
//   несопоставимых фаз; вторая система статусов научных данных не
//   создаётся — используется общий Core-контракт (DataProvenance,
//   Uncertainty, invalidateUncertainty, реестр единиц);
// - гидростатические профили планет, тепловая эволюция, фазовые
//   переходы и смешение компонентов — вне Stage 4.7.1;
// - все записи — ИЗОТЕРМИЧЕСКИЕ BM3 при 300 K. Это НЕ описывает
//   горячие недра планет (см. scopeNotes каждой записи и
//   CONDENSED_MATTER_EOS_STAGE_LIMITATIONS).
//
// Материалы каталога (2 записи, с полным происхождением каждого
// числового параметра):
//
// 1) fe_hcp_300k — hcp-Fe (гексагональное железо), изотерма 300 K:
//    Fei, Wang, Murphy, Schwegler & Prakapenka (2016), Geophys. Res.
//    Lett. 43, 6837–6845, DOI 10.1002/2016GL069456 — первоисточник
//    параметров BM3: rho0 = 8.2695 г/см3 (зафиксировано/округлено),
//    K0 = 172.7 ± 1.4 GPa, K0' = 4.79 ± 0.05, сжатие до ~280 GPa.
//    Те же значения указаны у Huang, Zhang, Wu, Lin & Mao (2019),
//    J. Geophys. Res.: Solid Earth 124, 8300–8319, DOI
//    10.1029/2019JB017983, Table 3 (строка Fe, hcp, со ссылкой на
//    Fei et al., 2016). Примечание: в HTML-рендеринге Table 3 этой
//    статьи колонка K0' артефактно снабжена подписью «km/s» —
//    в самом PDF единицы на колонку K0' не нанесены (безразмерная
//    величина); несоответствие снято сверкой с первоисточником Fei
//    et al. (2016), поэтому evidence = VERIFIED.
//
// 2) mgso3_bridgmanite_300k — бриджманит MgSiO3 (фаза перовскита),
//    изотерма 300 K: Myhill (2018), Contrib. Mineral. Petrol. 173:12,
//    DOI 10.1007/s00410-017-1436-z, Table 3: V0 = 24.45 cm3/mol,
//    K0 = 253 ± 2 GPa, K0' = 3.90 ± 0.10.
//    rho0 каталог НЕ берёт из воздуха: она ЯВНО выведена (origin:
//    'derived') из V0 через молярную массу Mg + Si + 3O с
//    документированными стандартными атомными весами CIAAW 2024 из
//    Data/elements.ts. СТЕХИОМЕТРИЧЕСКИЙ средний атомный вес —
//    интервал [100.38509, 100.39231] г/моль; принята середина
//    100.3887 г/моль (метод документирован в rawInput provenance;
//    неопределённость rho0 — интервал по весам CIAAW; вклад
//    неопределённости V0 в Table 3 не проверен и честно остаётся
//    неизвестным). Table 3 первоисточника подтверждена: V0 = 24.45 cm3/mol,
//    K0 = 253 ± 2 GPa, K0' = 3.90 ± 0.10; в тексте около Table 3 выбор
//    параметров MgSiO3 согласуется с Fiquet et al. (2000) и Murakami et al.
//    (2007); Figure 7 показывает BM3-описание MgSiO3 до ~150 GPa графически.
//    Статус записи — PARTIALLY_VERIFIED: параметры Table 3 подтверждены, но
//    ЯВНЫЙ численный барический диапазон применимости в первоисточнике не
//    установлен, поэтому pressureRangeKnown = false (fail-closed).
//
// Лицензии:
// - Myhill (2018) — открытая лицензия CC BY 4.0 (точный параметр
//   лицензии подтверждён для статьи через PMC);
// - Fei et al. (2016) — публикация GRL/American Geophysical Union:
//   лицензионный статус полного текста НЕ ПРОВЕРЕН; числовые
//   параметры цитируются добросовестно с полной атрибуцией, что
//   честно отражено в поле license записи.

import {
  validateCondensedMatterEosCatalog,
  validateCondensedMatterEosRecordShape,
  getCondensedMatterEosRecordBlockingIssues,
  type CondensedMatterEosRecord
} from '../Core/condensedMatterEos';

// ============================================
// 1. ОШИБКА FAIL-CLOSED LOOKUP
// ============================================

/** Отказ закрытого lookup по каталогу EOS планетных недр. */
export class PlanetaryEosLookupError extends Error {
  readonly code: string;
  readonly materialId: string;
  readonly issues: readonly string[];

  constructor(
    code: string,
    message: string,
    materialId: string,
    issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'PlanetaryEosLookupError';
    this.code = code;
    this.materialId = materialId;
    this.issues = issues;
  }
}

// ============================================
// 2. ГЛУБОКОЕ ЗАМОРАЖИВАНИЕ КАТАЛОГА
// ============================================

/**
 * Рекурсивное deepFreeze каталога (паттерн Stage 4.4.4.2): неизменность
 * provenance, неопределённостей и диапазонов в runtime; типы и так
 * Readonly.
 */
function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const prop = (value as Record<string, unknown>)[key];
      if (prop && typeof prop === 'object') deepFreeze(prop);
    }
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

// ============================================
// 3. ЗАПИСЬ 1: hcp-Fe, изотерма 300 K
// ============================================

const FEI_2016_SOURCE =
  'Fei, Y., Wang, Y., Murphy, C., Schwegler, E., Prakapenka, V. (2016). ' +
  'Equation of state of hexagonal closed packed iron under Earth\u2019s core conditions. ' +
  'Geophysical Research Letters, 43(13), 6837\u20136845. DOI 10.1002/2016GL069456';

const HUANG_2019_SOURCE =
  'Huang, D., Zhang, D., Wu, S., Lin, J.-F., Mao, Z. (2019). ' +
  'Compression behavior of hcp Fe at high pressure — Table 3 parameters cited from Fei et al. (2016). ' +
  'Journal of Geophysical Research: Solid Earth, 124, 8300\u20138319. DOI 10.1029/2019JB017983';

const HCP_FE_300K: CondensedMatterEosRecord = {
  materialId: 'fe_hcp_300k',
  displayName: 'Железо, гексагональная плотноупакованная фаза (hcp-Fe)',
  formula: 'Fe',
  formulaDisplay: 'Fe',
  phase: 'solid',
  crystalStructure: {
    designation: 'hcp (P6_3/mmc)',
    provenance: {
      origin: 'reported',
      evidence: 'VERIFIED',
      sourceName: 'Fei et al. (2016), GRL 43, 6837; Huang et al. (2019), JGR Solid Earth 124, Table 3',
      method: 'кристаллическая структура зафиксирована источником (hcp); фазовый переход bcc\u2192hcp при низких давлениях НЕ моделируется в этой записи',
      retrievedAt: '2026-11-20'
    },
    note: 'запись охватывает ТОЛЬКО hcp-фазу; жидкое железо и bcc-Fe — отдельные записи, смещать фазы запрещено'
  },
  eosModel: 'birch_murnaghan_3rd',
  referenceTemperatureK: {
    value: 300,
    unit: 'K',
    provenance: {
      origin: 'reported',
      evidence: 'VERIFIED',
      sourceName: 'Fei et al. (2016), GRL 43, 6837, DOI 10.1002/2016GL069456',
      method: 'изотермические измерения сжатия при 300 K, BM3-фит; подтверждено сверкой с Table 3 Huang et al. (2019)',
      conditions: 'изотерма 300 K, сжатие до ~280 GPa',
      retrievedAt: '2026-11-20'
    }
  },
  referencePressurePa: {
    value: 0,
    unit: 'Pa',
    provenance: {
      origin: 'reported',
      evidence: 'VERIFIED',
      sourceName: 'Fei et al. (2016), GRL 43, 6837, DOI 10.1002/2016GL069456',
      method: 'rho0 и K0 опубликованы как параметры нулевого (окружающего) давления; опорное давление формулы BM3 = 0 Pa',
      retrievedAt: '2026-11-20'
    }
  },
  referenceDensityKgM3: {
    value: 8269.5,
    unit: 'kg_m3',
    provenance: {
      origin: 'derived',
      evidence: 'VERIFIED',
      sourceName: 'Fei et al. (2016), GRL 43, 6837, DOI 10.1002/2016GL069456',
      method: 'опубликованное rho0 = 8.2695 г/см3 пересчитано в СИ: 8.2695 * 1000 = 8269.5 кг/м3',
      rawInput: { 'rho0_source_g_cm3': 8.2695 },
      applicability: 'состояние при 300 K, 0 Pa (ambient)',
      limitations: 'в зафиксированном Fei et al. (2016) значении rho0 погрешность по rho0 не публикуется; неопределённость НЕ нулевая, а НЕИЗВЕСТНАЯ',
      conditions: '300 K, 0 Pa',
      retrievedAt: '2026-11-20'
    }
  },
  bulkModulusPa: {
    value: 172.7e9,
    unit: 'Pa',
    uncertainty: {
      kind: 'stddev',
      sigma: 1.4e9,
      interpretation: '1\u03c3 неопределённость BM3-фита',
      note: 'из 172.7 \u00b1 1.4 GPa (Fei et al. 2016; согласуется с Huang et al. 2019, Table 3: 172.7 (1.4) GPa)'
    },
    provenance: {
      origin: 'reported',
      evidence: 'VERIFIED',
      sourceName: 'Fei et al. (2016), GRL 43, 6837, DOI 10.1002/2016GL069456',
      method: 'K0T из BM3-фита изотерм при 300 K до ~280 GPa; независимо сверено с Table 3 Huang et al. (2019)',
      note: 'Кросс-проверка: Huang et al. (2019), JGR 124, DOI 10.1029/2019JB017983, Table 3: 172.7 (1.4) GPa \u2014 согласуется',
      limitations: 'K0T — изотермический модуль объёмного сжатия при 300 K; адиабатический модуль и горячие состояния НЕ моделируются',
      retrievedAt: '2026-11-20'
    },
  },
  bulkModulusPressureDerivative: {
    value: 4.79,
    unit: '1',
    uncertainty: {
      kind: 'stddev',
      sigma: 0.05,
      interpretation: '1\u03c3 неопределённость BM3-фита',
      note: 'из 4.79 (5) (Fei et al. 2016; согласуется с Huang et al. 2019, Table 3: 4.79 (5))'
    },
    provenance: {
      origin: 'reported',
      evidence: 'VERIFIED',
      sourceName: 'Fei et al. (2016), GRL 43, 6837, DOI 10.1002/2016GL069456',
      method: 'K0\u2032 из BM3-фита изотерм при 300 K, до ~280 GPa; независимо сверено с Table 3 Huang et al. (2019)',
      note: 'Кросс-проверка: Huang et al. (2019), JGR 124, DOI 10.1029/2019JB017983, Table 3: 4.79 (5) \u2014 согласуется. В HTML-рендеринге Table 3 колонка K0\u2032 несёт артефактную подпись «km/s»; в первичном PDF и в Fei et al. (2016) K0\u2032 \u2014 БЕЗРАЗМЕРНАЯ, противоречие снято первоисточником',
      retrievedAt: '2026-11-20'
    }
  },
  applicability: {
    temperatureRangeKnown: true,
    temperatureRangeK: { min: 300, max: 300 },
    pressureRangeKnown: true,
    pressureRangePa: { min: 0, max: 280e9 },
    densityRangeKnown: true,
    densityRangeKgM3: { min: 8269.5, max: 13516.5 },
    note: 'подтверждено: изотерма 300 K в диапазоне давлений 0\u2013280 GPa (данные фита Fei et al. 2016); верх плотности 13516.5 кг/м3 (округление вверх точного решения 13516.49192) соответствует обратной задаче BM3 при 280 GPa (пересчитано в этом репозитории на СИ). НЕ подтверждено: температуры вне 300 K, жидкости, сплавы Fe (Fe-C и др.), bcc-фаза, фазовые переходы'
  },
  scopeNotes: [
    'запись охватывает ТОЛЬКО hcp-твёрдую фазу Fe при 300 K; жидкое Fe и сплавы не описываются',
    'изотермическое BM3 при 300 K НЕ описывает недра малых/массивных тел: тепловое давление и Ми\u2013Грюнайзен не моделируются',
    'фазовый переход bcc\u2192hcp при низких давлениях НЕ входит в запись; расчёт ниже перехода будет формальным'
  ],
  literature: [
    FEI_2016_SOURCE,
    HUANG_2019_SOURCE
  ],
  license:
    'лицензионный статус полных текстов GRL (Fei et al. 2016) и JGR (Huang et al. 2019) НЕ ПРОВЕРЕН; числовые параметры цитируются добросовестно с полной атрибуцией'
};

// ============================================
// 4. ЗАПИСЬ 2: бриджманит MgSiO3 (перовскит), изотерма 300 K
// ============================================

const MYHILL_2018_SOURCE =
  'Myhill, R. (2018). The elastic solid solution model for Minerals at High Pressures and Temperatures. ' +
  'Contributions to Mineralogy and Petrology, 173(2), Article 12. DOI 10.1007/s00410-017-1436-z';

// Расчёт rho0 из V0 (Stage 4.7.1, \u00a76.1 промта):
// M(MgSiO3) по серединам стандартных атомных весов CIAAW 2024
// (Data/elements.ts, стандартные атомные веса типа interval):
//   Mg: (24.304 + 24.307)/2 = 24.3055 г/моль
//   Si: (28.084 + 28.086)/2 = 28.0850 г/моль
//   O:  (15.99903 + 15.99977)/2 = 15.9994 г/моль
//   M = 24.3055 + 28.0850 + 3\u00b715.9994 = 100.3887 г/моль
// Стехиометрический интервал M: [100.38509, 100.39231] г/моль.
// rho0 = M / V0 = 100.3887 / 24.45 = 4.105877 г/см3 = 4105.877 кг/м3;
// интервал по весам: [4105.7297, 4106.0249] кг/м3.

const MGSO3_BRIDGMANITE_300K: CondensedMatterEosRecord = {
  materialId: 'mgso3_bridgmanite_300k',
  displayName: 'Бриджманит MgSiO3, фаза перовскита',
  formula: 'MgSiO3',
  formulaDisplay: 'MgSiO\u2083',
  phase: 'solid',
  crystalStructure: {
    designation: 'perovskite (Pbnm)',
    provenance: {
      origin: 'reported',
      evidence: 'PARTIALLY_VERIFIED',
      sourceName: 'Myhill (2018), CMP 173:12, DOI 10.1007/s00410-017-1436-z',
      method: 'перовскитовая структура зафиксирована источником для твердого MgSiO3 при давлениях перехода',
      retrievedAt: '2026-11-20'
    },
    note: 'постперовскит и другие его фазы НЕ входят в каталог; смешивать фазы запрещено'
  },
  eosModel: 'birch_murnaghan_3rd',
  referenceTemperatureK: {
    value: 300,
    unit: 'K',
    provenance: {
      origin: 'reported',
      evidence: 'PARTIALLY_VERIFIED',
      sourceName: 'Myhill (2018), CMP 173:12, DOI 10.1007/s00410-017-1436-z, Table 3',
      method: 'BM3-параметры приведены для 300 K (изотермический fit Table 3); полная проверка Table 3 ограничена доступом к тексту',
      conditions: 'изотерма 300 K',
      retrievedAt: '2026-11-20'
    }
  },
  referencePressurePa: {
    value: 0,
    unit: 'Pa',
    provenance: {
      origin: 'reported',
      evidence: 'PARTIALLY_VERIFIED',
      sourceName: 'Myhill (2018), CMP 173:12, DOI 10.1007/s00410-017-1436-z, Table 3',
      method: 'V0/K0/K0\u2032 Table 3 \u2014 параметры при нулевом давлении соответствующих fits; опорное давление формулы BM3 = 0 Pa',
      retrievedAt: '2026-11-20'
    }
  },
  referenceDensityKgM3: {
    value: 4105.877300613497,
    unit: 'kg_m3',
    uncertainty: {
      kind: 'interval',
      lower: 4105.7297,
      upper: 4106.0249,
      interpretation: 'интервал от разброса стехиометрической молярной массы CIAAW 2024 при фиксированной V0',
      note: 'вклад неопределённости V0 (Table 3) не проверен честно НЕИЗВЕСТЕН; интервал отражает ТОЛЬКО разброс атомных весов CIAAW 2024, а НЕ полную неопределённость rho0'
    },
    provenance: {
      origin: 'derived',
      evidence: 'PARTIALLY_VERIFIED',
      sourceName:
        'выведено в этом репозитории из V0 = 24.45 \u0441\u043c\u00b3/\u043c\u043e\u043b\u044c (Myhill 2018, Table 3) и стандартных атомных весов CIAAW 2024 (Data/elements.ts)',
      method:
        'rho0 = M(MgSiO3) / V0: середины CIAAW-интервалов \u2192 M = 100.3887 г/моль; 100.3887 / 24.45 * 1000 = 4105.877300613497 кг/м\u00b3 (округлённо 4105.877)',
      rawInput: {
        'V0_cm3_mol': 24.45,
        'Mg_stdaw_mid_g_mol': 24.3055,
        'Si_stdaw_mid_g_mol': 28.085,
        'O_stdaw_mid_g_mol': 15.9994,
        'M_mid_g_mol': 100.3887,
        'M_interval_lower_g_mol': 100.38509,
        'M_interval_upper_g_mol': 100.39231,
        'V0_uncertainty_not_checked': 'V0-компонент неопределённости не проверен (Table 3)'
      },
      applicability: 'стехиометрический MgSiO3 без неоднородностей; 300 K, 0 Pa',
      limitations: 'расчёт rho0 зависит от середины CIAAW-интервала (выбран явно); альтернативная параметризация SiO2\u2013MgO или изотопные вариации не учитываются; V0-неопределённость неизвестна',
      conditions: '300 K, 0 Pa',
      retrievedAt: '2026-11-20'
    }
  },
  bulkModulusPa: {
    value: 253e9,
    unit: 'Pa',
    uncertainty: {
      kind: 'stddev',
      sigma: 2e9,
      interpretation: '1\u03c3 неопределённость BM3-фита Table 3',
      note: 'из 253 \u00b1 2 GPa (Myhill 2018, Table 3); кросс-проверка: независимая аннотация OSTI даёт K0T \u2248 0.2532 \u00b1 0.0044 TPa (253.2 \u00b1 4.4 GPa) \u2014 согласуется в пределах 2\u03c3'
    },
    provenance: {
      origin: 'reported',
      evidence: 'PARTIALLY_VERIFIED',
      sourceName: 'Myhill (2018), CMP 173:12, DOI 10.1007/s00410-017-1436-z, Table 3',
      method: 'K0T из BM3-фита Table 3 при 300 K; Table 3 первоисточника: K0 = 253 \u00b1 2 GPa; параметры MgSiO3 согласованы в источнике с Fiquet et al. (2000) и Murakami et al. (2007)',
      note: 'Кросс-проверка: OSTI-аннотация перекрёстной публикации: 253.2 \u00b1 4.4 GPa \u2014 согласуется в пределах 2\u03c3; Table 3 подтверждена по подтверждённой библиографической записи (открытая копия: репозиторий Бристольского университета)',
      limitations: 'ниже давлений перехода в перовскит, выше перехода в постперовскит запись НЕ применима; постперовскит НЕ включён',
      retrievedAt: '2026-11-20'
    }
  },
  bulkModulusPressureDerivative: {
    value: 3.9,
    unit: '1',
    uncertainty: {
      kind: 'stddev',
      sigma: 0.1,
      interpretation: '1\u03c3 неопределённость BM3-фита Table 3',
      note: 'из 3.90 \u00b1 0.10 (Myhill 2018, Table 3)'
    },
    provenance: {
      origin: 'reported',
      evidence: 'PARTIALLY_VERIFIED',
      sourceName: 'Myhill (2018), CMP 173:12, DOI 10.1007/s00410-017-1436-z, Table 3',
      method: 'K0\u2032 из BM3-фита Table 3 при 300 K; Table 3 первоисточника: K0\u2032 = 3.90 \u00b1 0.10; BM3-описание MgSiO3 в источнике показано графически до ~150 GPa (Figure 7), что НЕ является заявленным диапазоном применимости',
      retrievedAt: '2026-11-20'
    }
  },
  applicability: {
    temperatureRangeKnown: true,
    temperatureRangeK: { min: 300, max: 300 },
    pressureRangeKnown: false,
    densityRangeKnown: false,
    note: 'подтверждено: запись представляет изотерму 300 K фазы перовскита MgSiO3; Table 3 первоисточника даёт V0 = 24.45 cm\u00b3/mol, K0 = 253 \u00b1 2 GPa, K0\u2032 = 3.90 \u00b1 0.10 (выбор параметров MgSiO3 согласован в источнике с Fiquet et al. 2000 и Murakami et al. 2007). НЕ подтверждено: ЯВНОГО численного барического диапазона применимости в первоисточнике нет (Figure 7 показывает BM3-описание MgSiO3 графически до ~150 GPa, но это протяжённость графика, а не заявленный диапазон применимости) \u2014 поэтому pressureRangeKnown = false (fail-closed) и оба давления вне подтверждения отклоняются; densityBracketKgM3 является численным инструментом поиска корня и НЕ доказательством применимости'
  },
  scopeNotes: [
    'изотермическое BM3 при 300 K НЕ описывает горячую нижнюю мантию Земли: тепловая поправка на этапе 4.7.1 отсутствует',
    'обратная задача \u03c1(P) для этой записи ОТКЛОНЯЕТСЯ (out_of_applicability): барический диапазон не подтверждён, и явный densityBracketKgM3 его не заменяет \u2014 bracket ищет численный корень, но не доказывает физическую применимость',
    'будем эти параметры только для фазы перовскита; постперовскит, жидкий MgSiO3, твердые растворы (Fe-, Al-бриджманит) \u2014 вне каталога'
  ],
  literature: [
    MYHILL_2018_SOURCE,
    'Стандартные атомные веса: CIAAW (2024), Isotopic Compositions of the Elements / Standard Atomic Weights; готовый источник: Data/elements.ts (Stage 4.3.3), публикация весов CIAAW 2024: www.ciaaw.org'
  ],
  license: 'CC BY 4.0 (Myhill 2018, лицензия статьи подтверждена через PMC); атомные веса CIAAW \u2014 свободные справочные данные'
};

// ============================================
// 5. КАТАЛОГ И FAIL-CLOSED LOOKUP
// ============================================

/** Явный скоп: конденсированные фазы; газовый PR-каталог не переиспользуется. */
export const PLANETARY_EOS_CATALOG_SCOPE_NOTE =
  'Stage 4.7.1: каталог изотермических BM3 EOS конденсированных материалов планетных недр ' +
  '(solid/liquid при 300 K). Газовый каталог Peng\u2013Robinson (Data/eosParameters.ts) не ' +
  'переиспользуется. Фазовые переходы, смешение и горячие EOS вне подэтапа.';

const PLANETARY_EOS_RECORDS_LIST: CondensedMatterEosRecord[] = [
  HCP_FE_300K,
  MGSO3_BRIDGMANITE_300K
];

/** Иммутабельный каталог записей (deep-frozen). */
export const PLANETARY_EOS_RECORDS: readonly CondensedMatterEosRecord[] = deepFreeze(
  PLANETARY_EOS_RECORDS_LIST
);

const PLANETARY_EOS_RECORD_INDEX: ReadonlyMap<string, CondensedMatterEosRecord> = new Map(
  PLANETARY_EOS_RECORDS.map((record) => [record.materialId, record])
);

/** Детерминированный список идентификаторов каталога. */
export function listPlanetaryEosMaterialIds(): readonly string[] {
  return PLANETARY_EOS_RECORDS.map((r) => r.materialId);
}

/**
 * Полная runtime-валидация каталога: структурная корректность каждой
 * записи (validateCondensedMatterEosRecordShape), пригодность параметров
 * (getCondensedMatterEosRecordBlockingIssues), уникальность ID и запрет
 * смешения фаз (validateCondensedMatterEosCatalog). Возвращает список
 * нарушений; пустой список — каталог пригоден.
 */
export function validatePlanetaryEosCatalog(
  records: readonly CondensedMatterEosRecord[] = PLANETARY_EOS_RECORDS
): string[] {
  const issues = validateCondensedMatterEosCatalog(records);
  for (const record of records) {
    for (const issue of getCondensedMatterEosRecordBlockingIssues(record)) {
      issues.push(`${record.materialId}: ${issue}`);
    }
  }
  return issues;
}

/**
 * Fail-closed lookup: неизвестный ID или структурно испорченная запись —
 * исключение PlanetaryEosLookupError, параметры НЕ выдаются.
 */
export function getPlanetaryEosRecord(materialId: string): CondensedMatterEosRecord {
  const record = PLANETARY_EOS_RECORD_INDEX.get(materialId);
  if (record === undefined) {
    throw new PlanetaryEosLookupError(
      'unknown_material',
      `материал «${materialId}» не входит в каталог EOS конденсированных материалов ` +
        `(Stage 4.7.1: ${listPlanetaryEosMaterialIds().join(', ')})`,
      materialId
    );
  }
  const issues = [
    ...validateCondensedMatterEosRecordShape(record),
    ...getCondensedMatterEosRecordBlockingIssues(record)
  ];
  if (issues.length > 0) {
    throw new PlanetaryEosLookupError(
      'invalid_catalog_record',
      `запись «${materialId}» не прошла валидацию; параметры НЕ выдаются`,
      materialId,
      issues
    );
  }
  return record;
}

/**
 * Не бросающий вариант lookup: null вместо исключения
 * (для потоков, где отказ обрабатывается значением).
 */
export function tryGetPlanetaryEosRecord(materialId: string): CondensedMatterEosRecord | null {
  try {
    return getPlanetaryEosRecord(materialId);
  } catch {
    return null;
  }
}
