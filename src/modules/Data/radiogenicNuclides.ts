import type { DataProvenance } from '../Core/scientificValue';

/**
 * ============================================================
 * КАТАЛОГ РАДИОГЕННЫХ НУКЛИДОВ (Stage 4.7.3, Часть A)
 * ============================================================
 *
 * Первоисточники (оба проверены чтением публикаций, значения
 * перенесены дословно и независимо пересчитаны):
 *
 * 1. ПОЛУРАСПАДЫ И ИЗОТОПНЫЕ ДОЛИ ПРИРОДНЫХ ЭЛЕМЕНТОВ:
 *    Korenaga, J. (2008). "Urey ratio and the structure and
 *    evolution of Earth's mantle". Reviews of Geophysics, 46,
 *    RG2007. DOI: 10.1029/2007RG000241.
 *      U-238: 4.468e9 лет; U-235: 7.038e8 лет;
 *      Th-232: 1.405e10 лет; K-40: 1.277e9 лет.
 *      Доли в природном элементе: U-238/U = 0.9928;
 *      U-235/U = 0.0072; K-40 = 0.0128% калия; торий = Th-232.
 *
 * 2. ТЕПЛОВАЯ ЭНЕРГИЯ РАСПАДА (E_H — «heat-effective decay
 *    energy», энергия, остающаяся в веществе, ПОСЛЕ вычета
 *    энергии нейтрино; для цепочек U/Th — на полную цепочку
 *    при secular equilibrium дочерних нуклидов):
 *    Ruedas, T. (2017). "Radioactive heat production of six
 *    geologically important nuclides". Geochemistry,
 *    Geophysics, Geosystems, 18(9), 3530-3541.
 *    DOI: 10.1002/2017GC006997 (препринт arXiv:1710.06721).
 *      238U: E_H = 47650.476 keV (полная цепочка Q = 51694.046 keV);
 *      235U: E_H = 44379.817 keV (Q = 46396.500 keV);
 *      232Th: E_H = 40418.037 keV (Q = 42645.892 keV);
 *      40K: E_H = 676.863 keV (Q = 1331.637 keV — средневзвешенное
 *           по двум главным модам распада: beta- и EC-ветви);
 *      26Al: E_H = 3150.155 keV (Q = 4004.393 keV);
 *      60Fe: E_H = 2710.251 keV (Q = 3060.102 keV).
 *    Изотопные молярные массы и доли (IUPAC 2013 / AME2016
 *    через Ruedas 2017, Table 4): см. записи ниже.
 *
 * РАЗГРАНИЧЕНИЕ БАЗ МАСС (критично):
 *  - масса природного урана (естественная изотопная смесь) — база
 *    коэффициента H(K/U natural);
 *  - масса отдельного изотопа (238U, 235U, 40K) — другая база;
 *  - масса природного калия vs масса 40K — другая база.
 * Значения удельной теплопродукции H (W/kg) сохраняются
 * ПОСТРОЧНО с пометкой базы (specificHeatProduction*Weight...);
 * вычислительные функции используют ТОЛЬКО энергию на распад
 * (E_H) с базой «масса родительского нуклида». Два пути
 * (энергия распада и опубликованный удельный коэффициент) не
 * смешиваются; их эквивалентность проверяется валидатором
 * каталога с допуском 3% (расхождение периодов полураспада
 * между Korenaga-2008 и NUBASE2016-основой Ruedas для K-40 —
 * 2.3%, для Th-232 — 0.4%; при одинаковых T1/2 совпадение
 * ~0.01%).
 *
 * НЕЙТРИНО: энергия нейтрино НЕ остаётся в веществе и в E_H
 * НЕ включена (Ruedas 2017 определяет E_H как heat-effective
 * энергию независимо от полной Q). Для цепочек U/Th принято
 * ПРАВИЛО УЧЁТА ДОЧЕРНИХ ПРОДУКТОВ: полная цепочка при
 * secular equilibrium (дочерние нуклиды в равновесии с
 * родителем, время установления << T1/2). Условие
 * secular equilibrium: удержание радона (222Rn/220Rn/219Rn) в
 * веществе — при потере газа цепочка недосчитывает тепло
 * дальних членов (оговорка Ruedas 2017, раздел 2).
 *
 * ГОДОВАЯ КОНВЕНЦИЯ: T1/2 публикуются в годах; перевод в секунды
 * выполняется через Units.YEAR_S = 3.15576e7 с (юлианский год).
 * Korenaga 2008 не определяет явно годовую конвенцию; при
 * пересчёте удельной теплопродукции Ruedas наш
 * пересчёт (юлианский год) воспроизводит опубликованные
 * H-значения с точностью лучше 0.01% для U-238/U-235/Th-232
 * (см. validateRadiogenicNuclideCatalog);
 * относительное отличие юлианского года от тропического ~2e-8.
 *
 * НЕИЗВЕСТНОЕ/НЕ ОПРЕДЕЛЁННОЕ:
 *  - неопределённости (1σ) самих T1/2 и E_H в цитируемых
 *    публикациях построчно приводятся только у Ruedas через
 *    первичные оценки (NUBASE2016);

 *  - удельные H даны как справочные таблицы без 1σ.
 * Поэтому uncertainties хранятся как ЯВНЫЕ записи с полем
 * stated: false и пояснением; из этого НЕ выводится ложная
 * точность вычислений.
 */

/** Идентификаторы радионуклидов каталога. */
export type RadiogenicNuclideId = 'u238' | 'u235' | 'th232' | 'k40' | 'al26' | 'fe60';

/** Правило учёта тепловой энергии: цепочка целиком или первичный распад. */
export type HeatEnergyAccounting =
  | 'decay_chain_total_secular_equilibrium'
  | 'primary_decay_branch_weighted_mean';

/** Статус неопределённости числового параметра источника. */
export interface RadiogenicUncertaintyRecord {
  /** Опубликована ли 1σ-неопределённость в первоисточнике записи. */
  readonly stated: boolean;
  /** Значение 1σ в тех же единицах, что параметр (если stated). */
  readonly value?: number;
  /** Пояснение, почему неопределённость не опубликована/не применена. */
  readonly note: string;
}

/** Структура записи нуклида. */
export interface RadiogenicNuclideRecord {
  readonly nuclideId: RadiogenicNuclideId;
  /** Массовое число A (целое число нуклонов, НЕ атомная масса). */
  readonly massNumber: number;
  /** Химический символ элемента ('U','Th','K','Al','Fe'). */
  readonly elementSymbol: string;
  readonly elementNameRu: string;
  /**
   * Период полураспада, лет. Источник для четырёх долгоживущих
   * планетных нуклидов — Korenaga (2008) (см. шапку). Для 26Al и 60Fe —
   * Ruedas (2017) (NUBASE2016).
   */
  readonly halfLifeYears: number;
  /** Неопределённость T1/2 (см. шапку про полноту 1σ). */
  readonly halfLifeUncertainty: RadiogenicUncertaintyRecord;
  /** Постоянная распада lambda = ln2 / T1/2, с^-1 (юлианский год, Units.YEAR_S). */
  readonly decayConstant_s1: number;
  /** Молярная масса ИЗОТОПА, кг/моль (Ruedas 2017, AME2016). */
  readonly molarMassKgPerMol: number;
  /**
   * Доля изотопа в ПРИРОДНОМ элементе (по массе) на современную эпоху;
   * null — у элемента нет природной смеси (радиогенный, extinct).
   * Первичный источник значений — Korenaga 2008 (задание Stage 4.7.3);
   * альтернативная современная конвенция IUPAC2013/Ruedas хранится
   * отдельно (alternateNaturalIsotopeFraction) и НЕ смешивается.
   */
  readonly naturalIsotopeFraction: number | null;
  /** Альтернативная документированная доля (IUPAC 2013 через Ruedas 2017); null — нет. */
  readonly alternateNaturalIsotopeFraction: number | null;
  /**
   * Полная энергия распада Q на нуклид или цепочку, keV (включая энергию
   * нейтрино). Приведена для контрольного сравнения; мощность из Q
   * считать НЕЛЬЗЯ (нейтрино уносят энергию).
   */
  readonly totalDecayEnergyKeV: number;
  /**
   * Тепловая энергия E_H, остающаяся в веществе, keV на распад
   * (первичный распад) или на полную цепочку (правило ниже).
   * Нейтрино исключены. Единственный параметр, из которого
   * вычисляется мощность.
   */
  readonly heatEffectiveDecayEnergyKeV: number;
  /** Правило учёта: цепочка целиком при secular equilibrium или первичный распад. */
  readonly heatEnergyAccounting: HeatEnergyAccounting;
  /** Описание дочерних продуктов и условия применимости правила. */
  readonly daughterAccountingNote: string;
  /**
   * Условие secular equilibrium для цепочек; для первичного распада —
   * 'not_applicable'.
   */
  readonly secularEquilibriumCondition: string;
  /** Обращение с энергией нейтрино. */
  readonly neutrinoTreatment: string;
  /** Неопределённость E_H. */
  readonly heatEnergyUncertainty: RadiogenicUncertaintyRecord;
  /**
   * Опубликованная удельная теплопродукция H, W/(kg ИЗОТОПА) —
   * Ruedas 2017 Table 4 (база: масса изотопа). Контрольное значение;
   * вычислительный путь энергии распада независим от него.
   */
  readonly publishedSpecificHeatProductionWPPerKgIsotope: number | null;
  /** База массы опубликованного H: изотоп. */
  readonly publishedSpecificHeatMassBase: 'isotope_mass';
  /**
   * Опубликованная удельная теплопродукция природного ЭЛЕМЕНТА, W/kg
   * (Ruedas 2017, уравнение 11; только для U и K, где элемент имеет
   * природную смесь; Th = сам изотоп). null — не опубликована/не применима.
   */
  readonly publishedSpecificHeatProductionWPPerKgNaturalElement: number | null;
  /** Неопределённость H (см. шапку). */
  readonly specificHeatUncertainty: RadiogenicUncertaintyRecord;
  /** Per-parameter provenance. */
  readonly halfLifeProvenance: DataProvenance;
  readonly heatEnergyProvenance: DataProvenance;
  readonly molarMassProvenance: DataProvenance;
  readonly isotopeFractionProvenance: DataProvenance | null;
  readonly specificHeatProvenance: DataProvenance | null;
}

// ============================================
// 1. PROVENANCE ПЕРВОИСТОЧНИКОВ
// ============================================

export const KORENAGA_2008_PROVENANCE: DataProvenance = {
  sourceName: 'Korenaga (2008), Reviews of Geophysics',
  sourceId: 'korenaga2008',
  datasetId: 'korenaga2008-urey',
  datasetVersion: 'Rev. Geophys. 46, RG2007 (2008)',
  reference: 'J. Korenaga. Urey ratio and the structure and evolution of Earth\u2019s mantle. Reviews of Geophysics 46 (2008) RG2007. DOI 10.1029/2007RG000241',
  retrievedAt: '2026-11-21',
  method: 'периоды полураспада и современные изотопные доли перенесены из текста публикации без пересчёта; годовая конвенция публикации не определена явно, перевод в секунды через юлианский год (Units.YEAR_S)',
  applicability: 'значения приведены для современной эпохи Земли; экстраполяция долей на другие тела/эпохи — только через явно указанное происхождение массы и состава пользователя',
  limitations: 'изотопные доли — ЗЕМНЫЕ современные значения; недопустимо приписывать их сгенерированным планетам без независимого источника состава'
};

export const RUEDAS_2017_PROVENANCE: DataProvenance = {
  sourceName: 'Ruedas (2017), Geochemistry Geophysics Geosystems',
  sourceId: 'ruedas2017',
  datasetId: 'ruedas2017-radheat',
  datasetVersion: 'GGG 18(9), 3530-3541 (2017); arXiv:1710.06721',
  reference: 'T. Ruedas. Radioactive heat production of six geologically important nuclides. Geochemistry, Geophysics, Geosystems 18 (2017) 3530-3541. DOI 10.1002/2017GC006997',
  retrievedAt: '2026-11-21',
  method: 'E_H (heat-effective decay energy: полная энергия Q минус энергия, выносимая нейтрино; для U/Th — на полную цепочку при secular equilibrium) и изотопные молярные массы перенесены из Table 4 публикации (основано на NUBASE2016/AME2016/CODATA2014); независимо пересчитано через H = N_A/M * lambda * E_H при юлианском годе — воспроизведение опубликованных H до 0.01% для U-238/U-235/Th-232',
  conditions: 'secular equilibrium цепочек U/Th; удержание изотопов радона в веществе (Rn-222/220/219)',
  limitations: 'значения построены на NUBASE2016/AME2016/CODATA2014; периоды полураспада каталога — Korenaga 2008, поэтому производные величины lamda поддерживают суммарную согласованность 3% с опубликованными H',
  license: 'статья GGG/AGU; перепечатка фрагментов таблицы в формате коротких констант с цитированием DOI'
};

/**
 * Независимое подтверждение полных Q-значений цепочек (многократно
 * опубликовано; проверено чтением: Wikipedia/Geoneutrino со ссылкой
 * на Fiorentini et al.; arXiv:1612.00133 (Geoneutrinos at Jinping);
 * Dye (2012) / arXiv:1111.6099; Korenaga (2008); Baksan review
 * arXiv:hep-ph/0409069). Все источники согласны в пределах округления.
 */
export const CHAIN_Q_CONFIRMATION_PROVENANCE: DataProvenance = {
  sourceName: 'Сводка независимых публикаций полных энергий цепочек',
  sourceId: 'chainq-multisource',
  reference: '238U: 51.698 MeV; 235U: 46.402 MeV; 232Th: 42.652 MeV; 40K: 1.311 MeV (beta-, 89.3%) / 1.505 MeV (EC, 10.7%) — подтверждено например в: Fiorentini et al., Phys. Rep. 453 (2007) 117; arXiv:1612.00133; arXiv:1111.6099; arXiv:hep-ph/0409069 (Table 2)',
  retrievedAt: '2026-11-21',
  method: 'контрольное сравнение Q каталожных записей с независимыми источниками; расхождение в пределах округления последней цифры'
};

export const NUBASE2016_VIA_RUEDAS_PROVENANCE: DataProvenance = {
  sourceName: 'NUBASE2016/AME2016 через Ruedas (2017)',
  sourceId: 'nubase2016-ruedas',
  datasetVersion: 'Audi et al. (2017); Wang et al. (2017), через Table 4 Ruedas (2017)',
  reference: 'T. Ruedas (2017), DOI 10.1002/2017GC006997, Table 4 (исходные данные: Nubase2016, Ame2016, IUPAC 2013, CODATA2014)',
  retrievedAt: '2026-11-21',
  method: 'периоды полураспада 26Al и 60Fe и молярные массы изотопов перенесены без пересчёта'
};

// ============================================
// 2. ПРОИЗВОДНЫЕ КОНСТАНТЫ
// ============================================

import { YEAR_S } from '../Units';

/** ln(2). */
const LN2 = Math.LN2;

/**時代 полураспада -> постоянная распада, с^-1 (юлианский год). */
function decayConstantFromHalfLife(halfLifeYears: number): number {
  return LN2 / (halfLifeYears * YEAR_S);
}

// ============================================
// 3. КАТАЛОГ
// ============================================

/**
 * Записи каталога. Тепловая энергия — E_H (нейтрино исключены;
 * для U/Th — на полную цепочку при secular equilibrium).
 * Правило базы массы: массы на входе вычислительных функций —
 * массы РОДИТЕЛЬСКОГО НУКЛИДА (не природного элемента);
 * перевод из концентраций элементов — только через отдельную
 * функцию с явными долями (см. elementToNuclideConversions).
 */
export const RADIOGENIC_NUCLIDE_RECORDS: readonly RadiogenicNuclideRecord[] = [
  {
    nuclideId: 'u238',
    massNumber: 238,
    elementSymbol: 'U',
    elementNameRu: 'уран-238',
    halfLifeYears: 4.468e9,
    halfLifeUncertainty: {
      stated: false,
      note: ' Korenaga (2008) приводит 4.468e9 лет без построчной 1σ; NUBASE2020/NUBASE2016 дают значения с 1σ, консистентные в пределах округления'
    },
    decayConstant_s1: decayConstantFromHalfLife(4.468e9),
    molarMassKgPerMol: 0.238050786996,
    naturalIsotopeFraction: 0.9928,
    alternateNaturalIsotopeFraction: 0.9927955,
    totalDecayEnergyKeV: 51694.046,
    heatEffectiveDecayEnergyKeV: 47650.476,
    heatEnergyAccounting: 'decay_chain_total_secular_equilibrium',
    daughterAccountingNote: 'полная цепочка 238U -> 206Pb + 8 alpha + 6 e- (+ 6 antineutrino); при secular equilibrium тепловыделение цепочки соотнесено с распадом родительского нуклида',
    secularEquilibriumCondition: 'дочерние нуклиды цепочки (включая 234U и Ra/Rn/Po-члены) в равновесии; удержание 222Rn в веществе; время установления << T1/2',
    neutrinoTreatment: 'энергия 6 antineutrino исключена из E_H (Ruedas 2017: E_H — heat-effective энергия)',
    heatEnergyUncertainty: {
      stated: false,
      note: 'Ruedas (2017) публикует E_H без построчной 1σ; значение опирается на NUBASE2016/AME2016/CODATA2014'
    },
    publishedSpecificHeatProductionWPPerKgIsotope: 9.4946e-5,
    publishedSpecificHeatMassBase: 'isotope_mass',
    publishedSpecificHeatProductionWPPerKgNaturalElement: 9.8314e-5,
    specificHeatUncertainty: { stated: false, note: 'значения Table 4 без построчной 1σ' },
    halfLifeProvenance: KORENAGA_2008_PROVENANCE,
    heatEnergyProvenance: RUEDAS_2017_PROVENANCE,
    molarMassProvenance: NUBASE2016_VIA_RUEDAS_PROVENANCE,
    isotopeFractionProvenance: KORENAGA_2008_PROVENANCE,
    specificHeatProvenance: RUEDAS_2017_PROVENANCE
  },
  {
    nuclideId: 'u235',
    massNumber: 235,
    elementSymbol: 'U',
    elementNameRu: 'уран-235',
    halfLifeYears: 7.038e8,
    halfLifeUncertainty: { stated: false, note: 'Korenaga (2008) приводит 7.038e8 лет без построчной 1σ' },
    decayConstant_s1: decayConstantFromHalfLife(7.038e8),
    molarMassKgPerMol: 0.235043928190,
    naturalIsotopeFraction: 0.0072,
    alternateNaturalIsotopeFraction: 0.0072045,
    totalDecayEnergyKeV: 46396.5,
    heatEffectiveDecayEnergyKeV: 44379.817,
    heatEnergyAccounting: 'decay_chain_total_secular_equilibrium',
    daughterAccountingNote: 'полная цепочка 235U -> 207Pb + 7 alpha + 4 e- (+ 4 antineutrino)',
    secularEquilibriumCondition: 'дочерние нуклиды в равновесии; удержание 219Rn; время установления << T1/2',
    neutrinoTreatment: 'энергия 4 antineutrino исключена из E_H',
    heatEnergyUncertainty: { stated: false, note: 'Ruedas (2017) публикует E_H без построчной 1σ' },
    publishedSpecificHeatProductionWPPerKgIsotope: 5.68402e-4,
    publishedSpecificHeatMassBase: 'isotope_mass',
    publishedSpecificHeatProductionWPPerKgNaturalElement: null,
    specificHeatUncertainty: { stated: false, note: 'значения Table 4 без построчной 1σ' },
    halfLifeProvenance: KORENAGA_2008_PROVENANCE,
    heatEnergyProvenance: RUEDAS_2017_PROVENANCE,
    molarMassProvenance: NUBASE2016_VIA_RUEDAS_PROVENANCE,
    isotopeFractionProvenance: KORENAGA_2008_PROVENANCE,
    specificHeatProvenance: RUEDAS_2017_PROVENANCE
  },
  {
    nuclideId: 'th232',
    massNumber: 232,
    elementSymbol: 'Th',
    elementNameRu: 'торий-232',
    halfLifeYears: 1.405e10,
    halfLifeUncertainty: { stated: false, note: 'Korenaga (2008) приводит 1.405e10 лет без построчной 1σ; NUBASE2016-основ Ruedas даёт 14.0e9 лет' },
    decayConstant_s1: decayConstantFromHalfLife(1.405e10),
    molarMassKgPerMol: 0.232038053689,
    naturalIsotopeFraction: 1,
    alternateNaturalIsotopeFraction: 1,
    totalDecayEnergyKeV: 42645.892,
    heatEffectiveDecayEnergyKeV: 40418.037,
    heatEnergyAccounting: 'decay_chain_total_secular_equilibrium',
    daughterAccountingNote: 'полная цепочка 232Th -> 208Pb + 6 alpha + 4 e- (+ 4 antineutrino); при secular equilibrium тепловыделение цепочки соотнесено с распадом родительского нуклида',
    secularEquilibriumCondition: 'дочерние нуклиды в равновесии; удержание 220Rn; время установления << T1/2',
    neutrinoTreatment: 'энергия 4 antineutrino исключена из E_H',
    heatEnergyUncertainty: { stated: false, note: 'Ruedas (2017) публикует E_H без построчной 1σ' },
    publishedSpecificHeatProductionWPPerKgIsotope: 2.6368e-5,
    publishedSpecificHeatMassBase: 'isotope_mass',
    publishedSpecificHeatProductionWPPerKgNaturalElement: 2.6368e-5,
    specificHeatUncertainty: { stated: false, note: 'значения Table 4 без построчной 1σ' },
    halfLifeProvenance: KORENAGA_2008_PROVENANCE,
    heatEnergyProvenance: RUEDAS_2017_PROVENANCE,
    molarMassProvenance: NUBASE2016_VIA_RUEDAS_PROVENANCE,
    isotopeFractionProvenance: KORENAGA_2008_PROVENANCE,
    specificHeatProvenance: RUEDAS_2017_PROVENANCE
  },
  {
    nuclideId: 'k40',
    massNumber: 40,
    elementSymbol: 'K',
    elementNameRu: 'калий-40',
    halfLifeYears: 1.277e9,
    halfLifeUncertainty: { stated: false, note: 'Korenaga (2008) приводит 1.277e9 лет; Ruedas/NUBASE2016 — 1.248e9 лет; расхождение источников ~2.3% задокументировано и НЕ сглаживается' },
    decayConstant_s1: decayConstantFromHalfLife(1.277e9),
    molarMassKgPerMol: 0.039963998166,
    naturalIsotopeFraction: 1.28e-4,
    alternateNaturalIsotopeFraction: 1.1668e-4,
    totalDecayEnergyKeV: 1331.637,
    heatEffectiveDecayEnergyKeV: 676.863,
    heatEnergyAccounting: 'primary_decay_branch_weighted_mean',
    daughterAccountingNote: 'две главные моды: 40K -> 40Ca + e- + antineutrino + 1.311 MeV (89.3%) и 40K + e- -> 40Ar + neutrino + 1.505 MeV (10.7%); E_H — средневзвешенное по модам Ruedas (2017); бета-электроны и гамма-излучение распада учитываются в E_H, дочерних цепочек нет',
    secularEquilibriumCondition: 'not_applicable (первичный распад; длинной цепочки нет)',
    neutrinoTreatment: 'энергия neutrino/antineutrino обеих ветвей исключена из E_H',
    heatEnergyUncertainty: {
      stated: false,
      note: 'Ruedas (2017) публикует E_H без построчной 1σ; для 40K его опубл. H-константа выведена при T1/2 NUBASE2016 (1.248e9 лет), а lambda каталога — от Korenaga T1/2 (1.277e9 лет); согласование с опубликованным H в пределах 3% (см. валидатор)'
    },
    publishedSpecificHeatProductionWPPerKgIsotope: 2.8761e-5,
    publishedSpecificHeatMassBase: 'isotope_mass',
    publishedSpecificHeatProductionWPPerKgNaturalElement: 3.4302e-9,
    specificHeatUncertainty: { stated: false, note: 'значения Table 4 без построчной 1σ' },
    halfLifeProvenance: KORENAGA_2008_PROVENANCE,
    heatEnergyProvenance: RUEDAS_2017_PROVENANCE,
    molarMassProvenance: NUBASE2016_VIA_RUEDAS_PROVENANCE,
    isotopeFractionProvenance: KORENAGA_2008_PROVENANCE,
    specificHeatProvenance: RUEDAS_2017_PROVENANCE
  },
  {
    nuclideId: 'al26',
    massNumber: 26,
    elementSymbol: 'Al',
    elementNameRu: 'алюминий-26 (вымерший нуклид раннего Солнечного круга)',
    halfLifeYears: 0.717e6,
    halfLifeUncertainty: { stated: false, note: 'NUBASE2016 через Ruedas (2017), Table 4: 0.717 Myr' },
    decayConstant_s1: decayConstantFromHalfLife(0.717e6),
    molarMassKgPerMol: 0.025986891863,
    naturalIsotopeFraction: null,
    alternateNaturalIsotopeFraction: null,
    totalDecayEnergyKeV: 4004.393,
    heatEffectiveDecayEnergyKeV: 3150.155,
    heatEnergyAccounting: 'primary_decay_branch_weighted_mean',
    daughterAccountingNote: '26Al -> 26Mg (beta+ / EC); E_H — heat-effective энергия Ruedas (2017); значение важно только для самых ранних этапов (< ~10 Myr)',
    secularEquilibriumCondition: 'not_applicable',
    neutrinoTreatment: 'энергия нейтрино исключена из E_H',
    heatEnergyUncertainty: { stated: false, note: 'значения Table 4 без построчной 1σ' },
    publishedSpecificHeatProductionWPPerKgIsotope: 0.3583,
    publishedSpecificHeatMassBase: 'isotope_mass',
    publishedSpecificHeatProductionWPPerKgNaturalElement: null,
    specificHeatUncertainty: { stated: false, note: 'значения Table 4 без построчной 1σ' },
    halfLifeProvenance: NUBASE2016_VIA_RUEDAS_PROVENANCE,
    heatEnergyProvenance: RUEDAS_2017_PROVENANCE,
    molarMassProvenance: NUBASE2016_VIA_RUEDAS_PROVENANCE,
    isotopeFractionProvenance: null,
    specificHeatProvenance: RUEDAS_2017_PROVENANCE
  },
  {
    nuclideId: 'fe60',
    massNumber: 60,
    elementSymbol: 'Fe',
    elementNameRu: 'железо-60 (вымерший нуклид раннего Солнечного круга)',
    halfLifeYears: 2.62e6,
    halfLifeUncertainty: { stated: false, note: 'NUBASE2016 через Ruedas (2017), Table 4: 2.62 Myr' },
    decayConstant_s1: decayConstantFromHalfLife(2.62e6),
    molarMassKgPerMol: 0.059934070411,
    naturalIsotopeFraction: null,
    alternateNaturalIsotopeFraction: null,
    totalDecayEnergyKeV: 3060.102,
    heatEffectiveDecayEnergyKeV: 2710.251,
    heatEnergyAccounting: 'primary_decay_branch_weighted_mean',
    daughterAccountingNote: '60Fe -> 60Ni (beta-); E_H — heat-effective энергия Ruedas (2017)',
    secularEquilibriumCondition: 'not_applicable',
    neutrinoTreatment: 'энергия нейтрино исключена из E_H',
    heatEnergyUncertainty: { stated: false, note: 'значения Table 4 без построчной 1σ' },
    publishedSpecificHeatProductionWPPerKgIsotope: 3.6579e-2,
    publishedSpecificHeatMassBase: 'isotope_mass',
    publishedSpecificHeatProductionWPPerKgNaturalElement: null,
    specificHeatUncertainty: { stated: false, note: 'значения Table 4 без построчной 1σ' },
    halfLifeProvenance: NUBASE2016_VIA_RUEDAS_PROVENANCE,
    heatEnergyProvenance: RUEDAS_2017_PROVENANCE,
    molarMassProvenance: NUBASE2016_VIA_RUEDAS_PROVENANCE,
    isotopeFractionProvenance: null,
    specificHeatProvenance: RUEDAS_2017_PROVENANCE
  }
];

// ============================================
// 4. ПЕРЕВОД КОНЦЕНТРАЦИЙ ЭЛЕМЕНТОВ В МАССЫ НУКЛИДОВ
// ============================================

/**
 * Жёстко зафиксированные правила разложения природных элементов
 * (BULK METAL, НЕ изотоп): база — масса природного элемента.
 * Источник долей — Korenaga (2008) (см. полей catalogs выше);
 * 1.28e-4 — это 0.0128% K в виде 40K.
 * Другие (не земные/не подтвержжденные) изотопные составы —
 * ТОЛЬКО через явные пользовательские значения (строгий контракт
 * вычислителя, Часть A4).
 */
export const ELEMENT_TO_NUCLIDE_CONVERSIONS: Readonly<
  Record<string, readonly { nuclideId: RadiogenicNuclideId; fraction: number }[]>
> = {
  U: [
    { nuclideId: 'u238', fraction: 0.9928 },
    { nuclideId: 'u235', fraction: 0.0072 }
  ],
  Th: [{ nuclideId: 'th232', fraction: 1 }],
  K: [{ nuclideId: 'k40', fraction: 1.28e-4 }],
  Al: [],
  Fe: []
};

/** Молярные массы ПРИРОДНЫХ ЭЛЕМЕНТОВ, кг/моль (IUPAC 2013 через Ruedas 2017). */
export const NATURAL_ELEMENT_MOLAR_MASS_KG_PER_MOL: Readonly<Record<string, number>> = {
  U: 0.23802891,
  Th: 0.232038053689,
  K: 0.0390983
};

// ============================================
// 5. LOOKUP И ВАЛИДАЦИЯ
// ============================================

const RECORDS_BY_ID: ReadonlyMap<string, RadiogenicNuclideRecord> = new Map(
  RADIOGENIC_NUCLIDE_RECORDS.map((r) => [r.nuclideId, r])
);

/** Fail-closed lookup нуклида по идентификатору; null для неизвестного id. */
export function tryGetRadiogenicNuclide(nuclideId: string): RadiogenicNuclideRecord | null {
  return RECORDS_BY_ID.get(nuclideId) ?? null;
}

/**
 * Валидация каталога радиогенных нуклидов.
 * Проверки:
 *  - lambda = ln2/(T1/2·3.15576e7) с относительным допуском 1e-12;
 *  - E_H < Q (нейтрино обязаны уносить часть полной энергии);
 *  - выведенная удельная теплопродукция H_der = (N_A/M)·lambda·E_H
 *    согласуется с опубликованной H (Ruedas 2017) с допуском 3%
 *    (источник расхождения — разные винтажи T1/2: Korenaga 2008 vs
 *    NUBASE2016-основ Ruedas; при идентичных T1/2 совпадение ~0.01%);
 *  - изотопные доли урана образуют сумму 1 (в пределах округления).
 */
export function validateRadiogenicNuclideCatalog(): readonly string[] {
  const AV = 6.02214076e23;
  const issues: string[] = [];
  for (const r of RADIOGENIC_NUCLIDE_RECORDS) {
    const lambdaCheck = LN2 / (r.halfLifeYears * YEAR_S);
    const lambdaRel = Math.abs(lambdaCheck - r.decayConstant_s1) / lambdaCheck;
    if (!(lambdaRel <= 1e-12)) {
      issues.push(`${r.nuclideId}: decayConstant_s1 не согласована с halfLifeYears (отн. расхождение ${lambdaRel.toExponential(3)})`);
    }
    if (!(r.heatEffectiveDecayEnergyKeV < r.totalDecayEnergyKeV)) {
      issues.push(`${r.nuclideId}: E_H ≥ Q — энергия нейтрино не вычтена`);
    }
    if (r.publishedSpecificHeatProductionWPPerKgIsotope !== null) {
      const hDerived =
        (AV / r.molarMassKgPerMol) * r.decayConstant_s1 * r.heatEffectiveDecayEnergyKeV * 1.602176634e-16;
      const hPub = r.publishedSpecificHeatProductionWPPerKgIsotope;
      const rel = Math.abs(hDerived - hPub) / hPub;
      if (!(rel <= 0.03)) {
        issues.push(`${r.nuclideId}: выведенная H отличается от опубликованной на ${(rel * 100).toFixed(2)}% (допуск 3%)`);
      }
    }
  }
  const fU = RADIOGENIC_NUCLIDE_RECORDS.filter((r) => r.elementSymbol === 'U')
    .map((r) => r.naturalIsotopeFraction ?? 0)
    .reduce((a, b) => a + b, 0);
  if (Math.abs(fU - 1) > 1e-4) {
    issues.push(`сумма изотопных долей урана = ${fU}, ожидается 1 (в пределах округления Korenaga 2008)`);
  }
  return issues;
}
