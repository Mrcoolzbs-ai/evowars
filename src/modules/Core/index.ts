// ============================================
// CORE SCIENTIFIC ENGINE - публичный вход Stage 4.1
// ============================================
//
// Единое научное ядро проекта Evolution Wars:
// физические величины и размерности, научные значения с
// происхождением, химические виды, резервуары, учёт потоков,
// состояние мира, время симуляции, контракты решателей,
// версионирование данных и миграции, адаптеры к легаси-модулям.
//
// Логические слои ядра (см. docs/science/CORE_SCIENTIFIC_ENGINE.md):
//   physicalQuantity  — величины и размерностный контроль;
//   scientificValue   — семантика данных и provenance;
//   species           — каталог химических видов;
//   elements          — каталог химических элементов периодической таблицы (4.3.3);
//   thermodynamics    — термодинамические свойства видов (4.3.1);
//   kinetics          — контракты кинетических записей и вычислитель k(T) (4.5.1–4.5.2);
//   reservoir         — материальные и энергетические резервуары;
//   fluxLedger        — потоки и балансы сохранения;
//   reactionLedger    — журнал реакционных транзакций и стехиометрический аудит (4.2.3.2);
//   simulationClock   — время симуляции;
//   worldClock        — мировая временная система поверх часов;
//   processRegistry   — реестр физических процессов (τ, политики шага);
//   scheduler         — планировщик процессов (Lie/Strang, sub-cycling);
//   invariantAuditor  — аудит инвариантов перехода состояния;
//   thermalState      — температурная иерархия и происхождение (4.2.2);
//   worldState        — каноническое состояние мира;
//   solverBackend     — контракты численных решателей;
//   odeSolver         — плотный ODE-решатель Radau IIA (4.5.3);
//   pengRobinson      — чистокомпонентный PR: Z, phi, фугитивность (4.4.4.2);
//                      чистая математика без импортов из Data; gasId-фасад
//                      каталога — Data/pengRobinsonFacade.ts (4.4.4.2.1);
//   pengRobinsonMixture — PR многокомпонентных смесей: правила смешения,
//                      кубика смеси, компонентные phi_i/f_i (4.4.4.3); чистая
//                      математика без импортов из Data; каталоги kij и чистых
//                      параметров — Data/pengRobinsonMixtureFacade.ts (4.4.4.3);
//   prTangentPlaneDistance — скалярный tangent-plane distance (TPD, dG/RT)
//                      для двух уже вычисленных состояний PR-смеси (4.4.4.4.1);
//                      ТОЛЬКО значение и вклады — без поиска минимумов и
//                      фазовых verdicts; не пересчитывает PR, не импортирует Data;
//   prTangentPlaneDistanceSearch — multi-start поиск минимумов TPD по граням
//                      носителя и ветвям физических корней (4.4.4.4.2): Wilson-
//                      старты, последовательное SS-смещение без fallback,
//                      строгие verdicts только по validated error bound,
//                      indeterminate с машинно-читаемой причиной иначе; не
//                      импортирует Data;
//   pengRobinsonFlash  — изотермо-изобарный многокомпонентный VLE flash
//                        (n >= 2, 4.4.4.6): Wilson-старт, Рачфорд–Райс,
//                      последовательные замены K по PR-фугитивностям;
//                      кандидат равновесия, verdict stable не выдаётся;
//   migrations        — версии схем, датасетов и миграции сохранений;
//   adapters          — мосты к существующим модулям (этап 1–3).

export * from './physicalQuantity';
export * from './scientificValue';
export * from './species';
export * from './elements';
export * from './thermodynamics';
export * from './thermoFunctions';
export * from './equilibrium';
export * from './kinetics';
export * from './reservoir';
export * from './fluxLedger';
export * from './reactionLedger';
export * from './simulationClock';
export * from './worldClock';
export * from './processRegistry';
export * from './scheduler';
export * from './invariantAuditor';
export * from './thermalState';
export * from './worldState';
export * from './solverBackend';
export * from './odeSolver';
export * from './pengRobinson';
export * from './pengRobinsonMixture';
export * from './prReactiveEquilibrium';
export * from './prTangentPlaneDistance';
export * from './prTangentPlaneDistanceSearch';
export * from './pengRobinsonFlash';
export * from './migrations';
export * from './adapters';
// Stage 4.7.1: ядро изотермического BM3 EOS конденсированных материалов.
export * from './condensedMatterEos';
// Stage 4.7.2: гидростатическая структура сферического тела (dm/dr, dP/dr, g).
export * from './hydrostaticInterior';
// Stage 4.7.3: радиогенный нагрев (Часть A).
export * from './radiogenicHeating';
// Stage 4.7.3: приливная диссипация синхронного спутника (Часть B).
export * from './tidalHeating';
// Stage 4.7.3: многорезервуарная тепловая эволюция (Часть C).
export * from './interiorThermalEvolution';
// Stage 4.7.3: аддитивный классификатор теплового бюджета по явным порогам (Часть D).
export * from './heatBudgetClassification';
// Stage 4.8.1: вертикальная гидростатическая структура атмосферы (колонка P(z), T(z), rho, g, H, столбы).
export * from './hydrostaticAtmosphere';
// Stage 4.8.2.1: спектральная непрозрачность (line-by-line: S(T), Doppler, Lorentz, Voigt, sigma, alpha).
export * from './spectralOpacity';




