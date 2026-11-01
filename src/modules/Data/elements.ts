// ============================================
// ELEMENTS - Данные всех 118 химических элементов (Stage 4.3.3)
// ============================================
//
// Каталог ChemicalElement — канонические данные периодической таблицы:
// идентификация IUPAC (таблица от 4 мая 2022), положение в таблице,
// редакционные категории с оговорками, стандартные атомные веса
// CIAAW 2024, изотопные распространённости CIAAW 2024 и
// репрезентативные изотопы-кандидаты (NUBASE2020, отдельный модуль
// elementIsotopeCandidates.ts).
//
// Полная атрибуция источников, версий, лицензий, методов преобразования
// и задокументированных расхождений: elementDataAttribution.md.
//
// Принципы Stage 4.3.3:
// - детерминизм: каталог строится только из таблиц ниже; никаких
//   сетевых запросов, случайности и времени выполнения;
// - provenance у КАЖДОГО свойства с recordId записи источника;
//   происхождение записи не подменяет происхождение значений;
// - интервальный атомный вес НЕ сводится к среднему; скобочная
//   неопределённость (1 сигма) НЕ отбрасывается;
// - not_assigned (прочерк CIAAW 2024) — самостоятельный статус:
//   НЕ ноль, НЕ неизвестное число, НЕ подстановка массового числа
//   долгоживущего изотопа;
// - массовое число изотопной записи — целое число нуклонов, НЕ
//   атомная масса изотопа и НЕ стандартный атомный вес элемента;
// - изотопные распространённости не нормализуются и не пересчитываются;
// - дополнительные атомные свойства (первая энергия ионизации,
//   сродство к электрону, электроотрицательность, атомный радиус,
//   температуры плавления и кипения, плотность) и строковые свойства
//   (электронная конфигурация, степени окисления) — unknown: источник
//   с подтверждённой лицензией не подключён (права NIST SRD не
//   подтверждены). unknown НЕ равен нулю.

import type { DataProvenance, ScientificValue } from '../Core/scientificValue';
import { unknownValue } from '../Core/scientificValue';
import type {
  ChemicalElement,
  ElementBlock,
  ElementCatalog,
  ElementCategory,
  ElementCategoryProperty,
  ElementIsotopicComposition,
  ElementPosition,
  ElementStringProperty,
  IsotopeRecord,
  StandardAtomicWeight
} from '../Core/elements';
import { createElementCatalog, ELEMENT_BLOCKS, ELEMENT_CATEGORIES, ELEMENT_COUNT } from '../Core/elements';
import { buildRepresentativeCandidates } from './elementIsotopeCandidates';

// ============================================
// 1. ПРОИСХОЖДЕНИЕ ИСТОЧНИКОВ
// ============================================

export const IUPAC_PT_2022_PROVENANCE: DataProvenance = {
  sourceName: 'IUPAC Periodic Table of the Elements',
  sourceId: 'iupac-pt',
  datasetId: 'iupac-periodic-table-2022-05-04',
  datasetVersion: 'выпуск 4 мая 2022',
  reference: 'https://iupac.org/what-we-do/periodic-table-of-elements/',
  retrievedAt: '2026-11-01',
  license: 'IUPAC о таблице: The table is yours to use; используются факты идентификации (атомные номера, символы, названия, положение), а не произведение целиком',
  method: 'идентификационные сведения перенесены без изменений'
};

export const CIAAW_SAW_2024_PROVENANCE: DataProvenance = {
  sourceName: 'CIAAW Standard Atomic Weights',
  sourceId: 'ciaaw-saw',
  datasetId: 'ciaaw-standard-atomic-weights-2024',
  datasetVersion: 'Standard Atomic Weights 2024',
  reference: 'https://ciaaw.org/atomic-weights.htm',
  retrievedAt: '2026-11-01',
  license: 'отдельной лицензии CIAAW не публикует; данные используются с обязательным цитированием источника (IUPAC/CIAAW), выполненным здесь и в elementDataAttribution.md',
  method: 'значения перенесены без пересчёта: интервалы сохранены как интервалы, скобочная неопределённость (1 сигма) разобрана в число по разрядности последней цифры, исходная нотация сохранена в rawNotation (типографские пробелы внутри чисел опущены, цифры не изменены)'
};

export const CIAAW_ISO_2024_PROVENANCE: DataProvenance = {
  sourceName: 'CIAAW Isotopic Compositions of the Elements',
  sourceId: 'ciaaw-iso',
  datasetId: 'ciaaw-isotopic-compositions-2024',
  datasetVersion: 'Isotopic Compositions of the Elements 2024',
  reference: 'https://ciaaw.org/isotopic-abundances.htm',
  retrievedAt: '2026-11-01',
  license: 'отдельной лицензии CIAAW не публикует; данные используются с обязательным цитированием источника (IUPAC/CIAAW)',
  method: 'долевые изотопные распространённости перенесены без нормализации и пересчёта; интервалы сохранены как интервалы; скобочная неопределённость (1 сигма) разобрана по разрядности; массовые числа — целые числа нуклонов, не атомные массы'
};

export const RU_NOMENCLATURE_PROVENANCE: DataProvenance = {
  sourceName: 'Русская химическая номенклатура (редакционная сводка)',
  sourceId: 'ru-element-nomenclature',
  datasetId: 'ru-element-nomenclature-editorial',
  datasetVersion: 'редакционная сводка 2026-11-01',
  retrievedAt: '2026-11-01',
  method: 'общепринятые русские названия элементов; НЕ перевод IUPAC: IUPAC не публикует официальных русских названий; написание «иод» по современной русской химической номенклатуре; названия элементов 113–118 — общепринятые русские варианты официальных английских названий (нихоний, флеровий, московий, ливерморий, теннессин, оганесон)',
  license: 'редакционное происхождение; соответствие официальному переводу НЕ утверждается'
};

export const CATEGORY_PROVENANCE: DataProvenance = {
  sourceName: 'Редакционная классификация по структуре таблицы IUPAC 2022-05-04',
  sourceId: 'element-categories',
  datasetId: 'element-categories-editorial',
  datasetVersion: 'редакционная классификация 2026-11-01',
  retrievedAt: '2026-11-01',
  method: 'IUPAC не публикует официальный список категорий; выбрана общепринятая классификация по положению и структуре таблицы; спорные случаи снабжены оговорками notes и не выбирались молча',
  limitations: 'категория — редакционное обобщение, а не факт из таблицы IUPAC; оговорки см. в поле notes записи элемента'
};

export const UNKNOWN_PROPERTY_PROVENANCE: DataProvenance = {
  sourceName: 'Stage 4.3.3: источник с подтверждённой лицензией не подключён',
  sourceId: 'stage-4-3-3-unknown',
  datasetId: 'stage-4-3-3-unknown',
  retrievedAt: '2026-11-01',
  method: 'свойство оставлено unknown: права NIST SRD (Standard Reference Data, 15 U.S.C. §290e) на распространение не подтверждены; другие источники в подэтапе не подключались; unknown НЕ равен нулю',
  limitations: 'значение отсутствует намеренно: без подтверждённой лицензии числовые записи не копируются'
};

// ============================================
// 2. СКБОЧНАЯ НЕОПРЕДЕЛЁННОСТЬ CIAAW
// ============================================

/**
 * Разбор скобочной записи CIAAW: значение(цифры) — стандартная
 * неопределённость последних разрядов (1 сигма). Например,
 * 4.002602(2) — неопределённость 0.000002; 173.045(10) — 0.010.
 * Неопределённость не отбрасывается и не округляется.
 */
export function parseCiaawBracketUncertainty(mantissa: string, brackets: string): number {
  if (!/^\d+$/.test(brackets)) {
    throw new Error('Stage 4.3.3: скобочная запись CIAAW должна содержать цифры, получено: ' + brackets);
  }
  const dot = mantissa.indexOf('.');
  const decimals = dot === -1 ? 0 : mantissa.length - dot - 1;
  return Number(brackets) * Math.pow(10, -decimals);
}

/** Разобранная числовая запись CIAAW: мантисса + скобки. */
interface CiaawNumeric {
  mantissa: string;
  value: number;
  brackets: string | null;
}

function parseCiaawNumeric(raw: string): CiaawNumeric {
  const open = raw.indexOf('(');
  const mantissa = open === -1 ? raw : raw.slice(0, open);
  const close = raw.indexOf(')');
  const brackets = open === -1 || close === -1 ? null : raw.slice(open + 1, close);
  if (!/^\d+(?:\.\d+)?$/.test(mantissa) || (brackets !== null && !/^\d+$/.test(brackets))) {
    throw new Error('Stage 4.3.3: не удалось разобрать числовую запись CIAAW: ' + raw);
  }
  return { mantissa, value: Number(mantissa), brackets };
}

// Идентификация IUPAC: Z | символ | английское название | русское название (редакционная номенклатура).
const IDENTIFICATION: readonly string[] = [
  '1|H|Hydrogen|водород',
  '2|He|Helium|гелий',
  '3|Li|Lithium|литий',
  '4|Be|Beryllium|бериллий',
  '5|B|Boron|бор',
  '6|C|Carbon|углерод',
  '7|N|Nitrogen|азот',
  '8|O|Oxygen|кислород',
  '9|F|Fluorine|фтор',
  '10|Ne|Neon|неон',
  '11|Na|Sodium|натрий',
  '12|Mg|Magnesium|магний',
  '13|Al|Aluminium|алюминий',
  '14|Si|Silicon|кремний',
  '15|P|Phosphorus|фосфор',
  '16|S|Sulfur|сера',
  '17|Cl|Chlorine|хлор',
  '18|Ar|Argon|аргон',
  '19|K|Potassium|калий',
  '20|Ca|Calcium|кальций',
  '21|Sc|Scandium|скандий',
  '22|Ti|Titanium|титан',
  '23|V|Vanadium|ванадий',
  '24|Cr|Chromium|хром',
  '25|Mn|Manganese|марганец',
  '26|Fe|Iron|железо',
  '27|Co|Cobalt|кобальт',
  '28|Ni|Nickel|никель',
  '29|Cu|Copper|медь',
  '30|Zn|Zinc|цинк',
  '31|Ga|Gallium|галлий',
  '32|Ge|Germanium|германий',
  '33|As|Arsenic|мышьяк',
  '34|Se|Selenium|селен',
  '35|Br|Bromine|бром',
  '36|Kr|Krypton|криптон',
  '37|Rb|Rubidium|рубидий',
  '38|Sr|Strontium|стронций',
  '39|Y|Yttrium|иттрий',
  '40|Zr|Zirconium|цирконий',
  '41|Nb|Niobium|ниобий',
  '42|Mo|Molybdenum|молибден',
  '43|Tc|Technetium|технеций',
  '44|Ru|Ruthenium|рутений',
  '45|Rh|Rhodium|родий',
  '46|Pd|Palladium|палладий',
  '47|Ag|Silver|серебро',
  '48|Cd|Cadmium|кадмий',
  '49|In|Indium|индий',
  '50|Sn|Tin|олово',
  '51|Sb|Antimony|сурьма',
  '52|Te|Tellurium|теллур',
  '53|I|Iodine|иод',
  '54|Xe|Xenon|ксенон',
  '55|Cs|Caesium|цезий',
  '56|Ba|Barium|барий',
  '57|La|Lanthanum|лантан',
  '58|Ce|Cerium|церий',
  '59|Pr|Praseodymium|празеодим',
  '60|Nd|Neodymium|неодим',
  '61|Pm|Promethium|прометий',
  '62|Sm|Samarium|самарий',
  '63|Eu|Europium|европий',
  '64|Gd|Gadolinium|гадолиний',
  '65|Tb|Terbium|тербий',
  '66|Dy|Dysprosium|диспрозий',
  '67|Ho|Holmium|гольмий',
  '68|Er|Erbium|эрбий',
  '69|Tm|Thulium|тулий',
  '70|Yb|Ytterbium|иттербий',
  '71|Lu|Lutetium|лютеций',
  '72|Hf|Hafnium|гафний',
  '73|Ta|Tantalum|тантал',
  '74|W|Tungsten|вольфрам',
  '75|Re|Rhenium|рений',
  '76|Os|Osmium|осмий',
  '77|Ir|Iridium|иридий',
  '78|Pt|Platinum|платина',
  '79|Au|Gold|золото',
  '80|Hg|Mercury|ртуть',
  '81|Tl|Thallium|таллий',
  '82|Pb|Lead|свинец',
  '83|Bi|Bismuth|висмут',
  '84|Po|Polonium|полоний',
  '85|At|Astatine|астат',
  '86|Rn|Radon|радон',
  '87|Fr|Francium|франций',
  '88|Ra|Radium|радий',
  '89|Ac|Actinium|актиний',
  '90|Th|Thorium|торий',
  '91|Pa|Protactinium|протактиний',
  '92|U|Uranium|уран',
  '93|Np|Neptunium|нептуний',
  '94|Pu|Plutonium|плутоний',
  '95|Am|Americium|америций',
  '96|Cm|Curium|кюрий',
  '97|Bk|Berkelium|берклий',
  '98|Cf|Californium|калифорний',
  '99|Es|Einsteinium|эйнштейний',
  '100|Fm|Fermium|фермий',
  '101|Md|Mendelevium|менделевий',
  '102|No|Nobelium|нобелий',
  '103|Lr|Lawrencium|лоуренсий',
  '104|Rf|Rutherfordium|резерфордий',
  '105|Db|Dubnium|дубний',
  '106|Sg|Seaborgium|сиборгий',
  '107|Bh|Bohrium|борий',
  '108|Hs|Hassium|хассий',
  '109|Mt|Meitnerium|мейтнерий',
  '110|Ds|Darmstadtium|дармштадтий',
  '111|Rg|Roentgenium|рентгений',
  '112|Cn|Copernicium|коперниций',
  '113|Nh|Nihonium|нихоний',
  '114|Fl|Flerovium|флеровий',
  '115|Mc|Moscovium|московий',
  '116|Lv|Livermorium|ливерморий',
  '117|Ts|Tennessine|теннессин',
  '118|Og|Oganesson|оганесон',
];

// Стандартные атомные веса CIAAW 2024: Z | запись (интервал [a,b] / значение(скобки) / прочерк) | сноски (g, m, r).
const STANDARD_ATOMIC_WEIGHTS: readonly string[] = [
  '1|[1.00784,1.00811]|m',
  '2|4.002602(2)|gr',
  '3|[6.938,6.997]|m',
  '4|9.0121831(5)|',
  '5|[10.806,10.821]|m',
  '6|[12.0096,12.0116]|',
  '7|[14.00643,14.00728]|m',
  '8|[15.99903,15.99977]|m',
  '9|18.998403162(5)|',
  '10|20.1797(6)|gm',
  '11|22.98976928(2)|',
  '12|[24.304,24.307]|',
  '13|26.9815384(3)|',
  '14|[28.084,28.086]|',
  '15|30.973761998(5)|',
  '16|[32.059,32.076]|',
  '17|[35.446,35.457]|m',
  '18|[39.792,39.963]|',
  '19|39.0983(1)|',
  '20|40.078(4)|g',
  '21|44.955907(4)|',
  '22|47.867(1)|',
  '23|50.9415(1)|',
  '24|51.9961(6)|',
  '25|54.938043(2)|',
  '26|55.845(2)|',
  '27|58.933194(3)|',
  '28|58.6934(4)|r',
  '29|63.546(3)|r',
  '30|65.38(2)|r',
  '31|69.723(1)|',
  '32|72.630(8)|',
  '33|74.921595(6)|',
  '34|78.971(8)|r',
  '35|[79.901,79.907]|',
  '36|83.798(2)|gm',
  '37|85.4678(3)|g',
  '38|87.62(1)|gr',
  '39|88.905838(2)|',
  '40|91.222(3)|g',
  '41|92.90637(1)|',
  '42|95.95(1)|g',
  '43|—|',
  '44|101.07(2)|g',
  '45|102.90549(2)|',
  '46|106.42(1)|g',
  '47|107.8682(2)|g',
  '48|112.414(4)|g',
  '49|114.818(1)|',
  '50|118.710(7)|g',
  '51|121.760(1)|g',
  '52|127.60(3)|g',
  '53|126.90447(3)|',
  '54|131.293(6)|gm',
  '55|132.90545196(6)|',
  '56|137.327(7)|',
  '57|138.90547(7)|g',
  '58|140.116(1)|g',
  '59|140.90766(1)|',
  '60|144.242(3)|g',
  '61|—|',
  '62|150.36(2)|g',
  '63|151.964(1)|g',
  '64|157.249(2)|g',
  '65|158.925354(7)|',
  '66|162.500(1)|g',
  '67|164.930329(5)|',
  '68|167.259(3)|g',
  '69|168.934219(5)|',
  '70|173.045(10)|g',
  '71|174.96669(5)|g',
  '72|178.486(6)|g',
  '73|180.94788(2)|',
  '74|183.84(1)|',
  '75|186.207(1)|',
  '76|190.23(3)|g',
  '77|192.217(2)|',
  '78|195.084(9)|',
  '79|196.966570(4)|',
  '80|200.592(3)|',
  '81|[204.382,204.385]|',
  '82|[206.14,207.94]|',
  '83|208.98040(1)|',
  '84|—|',
  '85|—|',
  '86|—|',
  '87|—|',
  '88|—|',
  '89|—|',
  '90|232.0377(4)|g',
  '91|231.03588(1)|',
  '92|238.02891(3)|gm',
  '93|—|',
  '94|—|',
  '95|—|',
  '96|—|',
  '97|—|',
  '98|—|',
  '99|—|',
  '100|—|',
  '101|—|',
  '102|—|',
  '103|—|',
  '104|—|',
  '105|—|',
  '106|—|',
  '107|—|',
  '108|—|',
  '109|—|',
  '110|—|',
  '111|—|',
  '112|—|',
  '113|—|',
  '114|—|',
  '115|—|',
  '116|—|',
  '117|—|',
  '118|—|',
];

// Изотопные составы CIAAW 2024: Z | записи A:распространённость;… | NA:A — только массовое число; ABSENT — элемент вне таблицы.
const ISOTOPIC_COMPOSITIONS: readonly string[] = [
  '1|1:[0.99972,0.99999];2:[0.00001,0.00028]|m',
  '2|3:0.000002(2);4:0.999998(2)|gr',
  '3|6:[0.019,0.078];7:[0.922,0.981]|m',
  '4|9:1|',
  '5|10:[0.189,0.204];11:[0.796,0.811]|m',
  '6|12:[0.9884,0.9904];13:[0.0096,0.0116]|',
  '7|14:[0.99578,0.99663];15:[0.00337,0.00422]|m',
  '8|16:[0.99738,0.99776];17:[0.000367,0.000400];18:[0.00187,0.00222]|m',
  '9|19:1|',
  '10|20:0.9048(3);21:0.0027(1);22:0.0925(3)|gm',
  '11|23:1|',
  '12|24:[0.7888,0.7905];25:[0.09988,0.10034];26:[0.1096,0.1109]|',
  '13|27:1|',
  '14|28:[0.92191,0.92318];29:[0.04645,0.04699];30:[0.03037,0.03110]|',
  '15|31:1|',
  '16|32:[0.9441,0.9529];33:[0.00729,0.00797];34:[0.0396,0.0477];36:[0.000129,0.000187]|',
  '17|35:[0.755,0.761];37:[0.239,0.245]|m',
  '18|36:[0.0000,0.0207];38:[0.000,0.043];40:[0.936,1.000]|gr',
  '19|39:0.932581(44);40:0.000117(1);41:0.067302(44)|',
  '20|40:0.96941(156);42:0.00647(23);43:0.00135(10);44:0.02086(110);46:0.00004(3);48:0.00187(21)|g',
  '21|45:1|',
  '22|46:0.0825(3);47:0.0744(2);48:0.7372(3);49:0.0541(2);50:0.0518(2)|',
  '23|50:0.00250(10);51:0.99750(10)|',
  '24|50:0.04345(13);52:0.83789(18);53:0.09501(17);54:0.02365(7)|',
  '25|55:1|',
  '26|54:0.05845(105);56:0.91754(106);57:0.02119(29);58:0.00282(12)|',
  '27|59:1|',
  '28|58:0.680769(190);60:0.262231(150);61:0.011399(13);62:0.036345(40);64:0.009256(19)|r',
  '29|63:0.6915(15);65:0.3085(15)|r',
  '30|64:0.4917(75);66:0.2773(98);67:0.0404(16);68:0.1845(63);70:0.0061(10)|r',
  '31|69:0.60108(50);71:0.39892(50)|',
  '32|70:0.2052(19);72:0.2745(15);73:0.0776(8);74:0.3652(12);76:0.0775(12)|',
  '33|75:1|',
  '34|74:0.0086(3);76:0.0923(7);77:0.0760(7);78:0.2369(22);80:0.4980(36);82:0.0882(15)|r',
  '35|79:[0.505,0.508];81:[0.492,0.495]|',
  '36|78:0.00355(3);80:0.02286(10);82:0.11593(31);83:0.11500(19);84:0.56987(15);86:0.17279(41)|gm',
  '37|85:0.7217(2);87:0.2783(2)|g',
  '38|84:0.0056(2);86:0.0986(20);87:0.0700(20);88:0.8258(35)|gr',
  '39|89:1|',
  '40|90:0.5147(6);91:0.1123(6);92:0.1716(4);94:0.1736(7);96:0.0278(4)|g',
  '41|93:1|',
  '42|92:0.14649(106);94:0.09187(33);95:0.15873(30);96:0.16673(8);97:0.09582(15);98:0.24292(80);100:0.09744(65)|g',
  '43|NA:97|',
  '44|96:0.0554(14);98:0.0187(3);99:0.1276(14);100:0.1260(7);101:0.1706(2);102:0.3155(14);104:0.1862(27)|g',
  '45|103:1|',
  '46|102:0.0102(1);104:0.1114(8);105:0.2233(8);106:0.2733(3);108:0.2646(9);110:0.1172(9)|g',
  '47|107:0.51839(8);109:0.48161(8)|g',
  '48|106:0.01245(22);108:0.00888(11);110:0.12470(61);111:0.12795(12);112:0.24109(7);113:0.12227(7);114:0.28754(81);116:0.07512(54)|g',
  '49|113:0.04281(52);115:0.95719(52)|',
  '50|112:0.0097(1);114:0.0066(1);115:0.0034(1);116:0.1454(9);117:0.0768(7);118:0.2422(9);119:0.0859(4);120:0.3258(9);122:0.0463(3);124:0.0579(5)|g',
  '51|121:0.5721(5);123:0.4279(5)|g',
  '52|120:0.0009(1);122:0.0255(12);123:0.0089(3);124:0.0474(14);125:0.0707(15);126:0.1884(25);128:0.3174(8);130:0.3408(62)|g',
  '53|127:1|',
  '54|124:0.00095(5);126:0.00089(3);128:0.01910(13);129:0.26401(138);130:0.04071(22);131:0.21232(51);132:0.26909(55);134:0.10436(35);136:0.08857(72)|gm',
  '55|133:1|',
  '56|130:0.0011(1);132:0.0010(1);134:0.0242(15);135:0.0659(10);136:0.0785(24);137:0.1123(23);138:0.7170(29)|',
  '57|138:0.0008881(71);139:0.9991119(71)|g',
  '58|136:0.00185(2);138:0.00251(2);140:0.88450(51);142:0.11114(51)|g',
  '59|141:1|',
  '60|142:0.27152(40);143:0.12174(26);144:0.23798(19);145:0.08293(12);146:0.17189(32);148:0.05756(21);150:0.05638(28)|g',
  '61|NA:145|',
  '62|144:0.0308(4);147:0.1500(14);148:0.1125(9);149:0.1382(10);150:0.0737(9);152:0.2674(9);154:0.2274(14)|g',
  '63|151:0.4781(6);153:0.5219(6)|g',
  '64|152:0.00204(2);154:0.02187(9);155:0.14828(60);156:0.20493(22);157:0.15657(17);158:0.24820(20);160:0.21811(28)|g',
  '65|159:1|',
  '66|156:0.00056(3);158:0.00095(3);160:0.02329(18);161:0.18889(42);162:0.25475(36);163:0.24896(42);164:0.28260(54)|g',
  '67|165:1|',
  '68|162:0.00139(5);164:0.01601(3);166:0.33503(36);167:0.22869(9);168:0.26978(18);170:0.14910(36)|g',
  '69|169:1|',
  '70|168:0.00126(1);170:0.03023(2);171:0.14216(7);172:0.21754(10);173:0.16098(9);174:0.31896(26);176:0.12887(30)|g',
  '71|175:0.97414(5);176:0.02586(5)|g',
  '72|174:0.00161(2);176:0.0524(14);177:0.1858(9);178:0.2728(6);179:0.1363(3);180:0.3512(16)|g',
  '73|180:0.0001176(23);181:0.9998824(23)|',
  '74|180:0.0012(1);182:0.2650(16);183:0.1431(4);184:0.3064(2);186:0.2843(19)|',
  '75|185:0.3740(5);187:0.6260(5)|',
  '76|184:0.0002(2);186:0.0159(64);187:0.0196(17);188:0.1324(27);189:0.1615(23);190:0.2626(20);192:0.4078(32)|g',
  '77|191:0.3723(9);193:0.6277(9)|',
  '78|190:0.00012(2);192:0.00782(24);194:0.32864(410);195:0.33775(240);196:0.25211(340);198:0.07356(130)|',
  '79|197:1|',
  '80|196:0.0015(1);198:0.1004(3);199:0.1694(12);200:0.2314(9);201:0.1317(9);202:0.2974(13);204:0.0682(4)|',
  '81|203:[0.2944,0.2959];205:[0.7041,0.7056]|',
  '82|204:[0.0000,0.0158];206:[0.0190,0.8673];207:[0.0035,0.2351];208:[0.0338,0.9775]|',
  '83|209:1|',
  '84|NA:209|',
  '85|NA:210|',
  '86|NA:222|',
  '87|NA:223|',
  '88|NA:226|',
  '89|NA:227|',
  '90|230:0.0002(2);232:0.9998(2)|g',
  '91|231:1|',
  '92|234:0.000054(5);235:0.007204(6);238:0.992742(10)|gm',
  '93|ABSENT|',
  '94|ABSENT|',
  '95|ABSENT|',
  '96|ABSENT|',
  '97|ABSENT|',
  '98|ABSENT|',
  '99|ABSENT|',
  '100|ABSENT|',
  '101|ABSENT|',
  '102|ABSENT|',
  '103|ABSENT|',
  '104|ABSENT|',
  '105|ABSENT|',
  '106|ABSENT|',
  '107|ABSENT|',
  '108|ABSENT|',
  '109|ABSENT|',
  '110|ABSENT|',
  '111|ABSENT|',
  '112|ABSENT|',
  '113|ABSENT|',
  '114|ABSENT|',
  '115|ABSENT|',
  '116|ABSENT|',
  '117|ABSENT|',
  '118|ABSENT|',
];

// Положение в таблице IUPAC: Z | группа (— не назначена) | период | блок (— спорен).
const POSITIONS: readonly string[] = [
  '1|1|1|s',
  '2|18|1|s',
  '3|1|2|s',
  '4|2|2|s',
  '5|13|2|p',
  '6|14|2|p',
  '7|15|2|p',
  '8|16|2|p',
  '9|17|2|p',
  '10|18|2|p',
  '11|1|3|s',
  '12|2|3|s',
  '13|13|3|p',
  '14|14|3|p',
  '15|15|3|p',
  '16|16|3|p',
  '17|17|3|p',
  '18|18|3|p',
  '19|1|4|s',
  '20|2|4|s',
  '21|3|4|d',
  '22|4|4|d',
  '23|5|4|d',
  '24|6|4|d',
  '25|7|4|d',
  '26|8|4|d',
  '27|9|4|d',
  '28|10|4|d',
  '29|11|4|d',
  '30|12|4|d',
  '31|13|4|p',
  '32|14|4|p',
  '33|15|4|p',
  '34|16|4|p',
  '35|17|4|p',
  '36|18|4|p',
  '37|1|5|s',
  '38|2|5|s',
  '39|3|5|d',
  '40|4|5|d',
  '41|5|5|d',
  '42|6|5|d',
  '43|7|5|d',
  '44|8|5|d',
  '45|9|5|d',
  '46|10|5|d',
  '47|11|5|d',
  '48|12|5|d',
  '49|13|5|p',
  '50|14|5|p',
  '51|15|5|p',
  '52|16|5|p',
  '53|17|5|p',
  '54|18|5|p',
  '55|1|6|s',
  '56|2|6|s',
  '57|-|6|-',
  '58|-|6|f',
  '59|-|6|f',
  '60|-|6|f',
  '61|-|6|f',
  '62|-|6|f',
  '63|-|6|f',
  '64|-|6|f',
  '65|-|6|f',
  '66|-|6|f',
  '67|-|6|f',
  '68|-|6|f',
  '69|-|6|f',
  '70|-|6|f',
  '71|-|6|-',
  '72|4|6|d',
  '73|5|6|d',
  '74|6|6|d',
  '75|7|6|d',
  '76|8|6|d',
  '77|9|6|d',
  '78|10|6|d',
  '79|11|6|d',
  '80|12|6|d',
  '81|13|6|p',
  '82|14|6|p',
  '83|15|6|p',
  '84|16|6|p',
  '85|17|6|p',
  '86|18|6|p',
  '87|1|7|s',
  '88|2|7|s',
  '89|-|7|-',
  '90|-|7|f',
  '91|-|7|f',
  '92|-|7|f',
  '93|-|7|f',
  '94|-|7|f',
  '95|-|7|f',
  '96|-|7|f',
  '97|-|7|f',
  '98|-|7|f',
  '99|-|7|f',
  '100|-|7|f',
  '101|-|7|f',
  '102|-|7|f',
  '103|-|7|-',
  '104|4|7|d',
  '105|5|7|d',
  '106|6|7|d',
  '107|7|7|d',
  '108|8|7|d',
  '109|9|7|d',
  '110|10|7|d',
  '111|11|7|d',
  '112|12|7|d',
  '113|13|7|p',
  '114|14|7|p',
  '115|15|7|p',
  '116|16|7|p',
  '117|17|7|p',
  '118|18|7|p',
];

// Редакционные категории: Z | категория (— unknown).
const CATEGORIES: readonly string[] = [
  '1|reactive_nonmetal',
  '2|noble_gas',
  '3|alkali_metal',
  '4|alkaline_earth_metal',
  '5|metalloid',
  '6|reactive_nonmetal',
  '7|reactive_nonmetal',
  '8|reactive_nonmetal',
  '9|halogen',
  '10|noble_gas',
  '11|alkali_metal',
  '12|alkaline_earth_metal',
  '13|post_transition_metal',
  '14|metalloid',
  '15|reactive_nonmetal',
  '16|reactive_nonmetal',
  '17|halogen',
  '18|noble_gas',
  '19|alkali_metal',
  '20|alkaline_earth_metal',
  '21|transition_metal',
  '22|transition_metal',
  '23|transition_metal',
  '24|transition_metal',
  '25|transition_metal',
  '26|transition_metal',
  '27|transition_metal',
  '28|transition_metal',
  '29|transition_metal',
  '30|transition_metal',
  '31|post_transition_metal',
  '32|metalloid',
  '33|metalloid',
  '34|reactive_nonmetal',
  '35|halogen',
  '36|noble_gas',
  '37|alkali_metal',
  '38|alkaline_earth_metal',
  '39|transition_metal',
  '40|transition_metal',
  '41|transition_metal',
  '42|transition_metal',
  '43|transition_metal',
  '44|transition_metal',
  '45|transition_metal',
  '46|transition_metal',
  '47|transition_metal',
  '48|transition_metal',
  '49|post_transition_metal',
  '50|post_transition_metal',
  '51|metalloid',
  '52|metalloid',
  '53|halogen',
  '54|noble_gas',
  '55|alkali_metal',
  '56|alkaline_earth_metal',
  '57|lanthanoid',
  '58|lanthanoid',
  '59|lanthanoid',
  '60|lanthanoid',
  '61|lanthanoid',
  '62|lanthanoid',
  '63|lanthanoid',
  '64|lanthanoid',
  '65|lanthanoid',
  '66|lanthanoid',
  '67|lanthanoid',
  '68|lanthanoid',
  '69|lanthanoid',
  '70|lanthanoid',
  '71|lanthanoid',
  '72|transition_metal',
  '73|transition_metal',
  '74|transition_metal',
  '75|transition_metal',
  '76|transition_metal',
  '77|transition_metal',
  '78|transition_metal',
  '79|transition_metal',
  '80|transition_metal',
  '81|post_transition_metal',
  '82|post_transition_metal',
  '83|post_transition_metal',
  '84|post_transition_metal',
  '85|halogen',
  '86|noble_gas',
  '87|alkali_metal',
  '88|alkaline_earth_metal',
  '89|actinoid',
  '90|actinoid',
  '91|actinoid',
  '92|actinoid',
  '93|actinoid',
  '94|actinoid',
  '95|actinoid',
  '96|actinoid',
  '97|actinoid',
  '98|actinoid',
  '99|actinoid',
  '100|actinoid',
  '101|actinoid',
  '102|actinoid',
  '103|actinoid',
  '104|-',
  '105|-',
  '106|-',
  '107|-',
  '108|-',
  '109|-',
  '110|-',
  '111|-',
  '112|-',
  '113|-',
  '114|-',
  '115|-',
  '116|-',
  '117|-',
  '118|-',
];

/** Сноски таблиц CIAAW (тексты по официальным определениям CIAAW). */
const SAW_FOOTNOTES: Readonly<Record<string, string>> = {
  g: 'сноска CIAAW g: известны геологические и биологические образцы, в которых изотопный состав элемента выходит за пределы нормального материала',
  m: 'сноска CIAAW m: в коммерчески доступном материале изотопный состав может отличаться от нормального',
  r: 'сноска CIAAW r: разброс изотопного состава нормального земного материала не позволяет назначить более точный стандартный атомный вес'
};

/** Оговорки спорных категорий (выбор задокументирован, а не скрыт). */
const CATEGORY_NOTES: Readonly<Record<number, string>> = {
  1: 'водород стоит в группе 1, но не щелочной металл; категория reactive_nonmetal — распространённая классификация; IUPAC официальный список категорий не публикует',
  30: 'цинк (группа 12) в некоторых классификациях относят к постпереходным металлам; здесь — переходный металл по d-блоку; выбор задокументирован, а не скрыт',
  34: 'селен в некоторых классификациях относят к металлоидам; здесь — реактивный неметалл; выбор задокументирован, а не скрыт',
  48: 'кадмий (группа 12) в некоторых классификациях относят к постпереходным металлам; здесь — переходный металл по d-блоку; выбор задокументирован, а не скрыт',
  80: 'ртуть (группа 12) в некоторых классификациях относят к постпереходным металлам; здесь — переходный металл по d-блоку; выбор задокументирован, а не скрыт',
  83: 'висмут в некоторых классификациях относят к металлоидам; здесь — постпереходный металл; выбор задокументирован, а не скрыт',
  84: 'полоний: классификация спорна (постпереходный металл, металлоид или переходный металл в разных источниках); выбран постпереходный металл; спорность зафиксирована, а не скрыта',
  85: 'астат: классификация спорна (галоген или металлоид в разных источниках); выбран галоген по положению в группе 17; спорность зафиксирована, а не скрыта'
};

const NOT_ASSIGNED_REASON = 'CIAAW 2024 ставит для элемента прочерк: стандартный атомный вес не назначается (все нуклиды радиоактивны и таблица не назначает представительную величину). Это НЕ ноль, НЕ неизвестное число и НЕ подстановка массового числа долгоживущего изотопа; репрезентативные изотопы-кандидаты — в representativeIsotopeCandidates';

const GROUP3_REASON = 'вопрос группы 3 периодической таблицы (La/Ac или Lu/Lr) IUPAC не закрыт: элемент относится к f-строке макета, позиция группы в таблице IUPAC 2022-05-04 не назначается';
const BLOCK3_REASON = 'блок спорен из-за открытого вопроса группы 3 (La/Lu для Z=57/71, Ac/Lr для Z=89/103): элемент не относится однозначно к d- или f-блоку';

// ============================================
// 3. ПАРСИНГ ТАБЛИЦ И ИНВАРИАНТЫ
// ============================================

interface ElementIdentification {
  z: number;
  symbol: string;
  nameEnglish: string;
  nameRussian: string;
}

const IDENT_ROWS: readonly ElementIdentification[] = IDENTIFICATION.map((row) => {
  const cells = row.split('|');
  return { z: Number(cells[0]), symbol: cells[1] ?? '', nameEnglish: cells[2] ?? '', nameRussian: cells[3] ?? '' };
});

// Инварианты данных (fail fast при повреждении таблиц; проверка
// детерминирована и не зависит от сети и времени).
const DATA_INVARIANT_PROBLEMS: string[] = [];
if (IDENT_ROWS.length !== ELEMENT_COUNT) {
  DATA_INVARIANT_PROBLEMS.push('IDENTIFICATION должен содержать ' + String(ELEMENT_COUNT) + ' строк, содержит ' + String(IDENT_ROWS.length));
}
const seenNumbers = new Set<number>();
const seenSymbols = new Set<string>();
for (const row of IDENT_ROWS) {
  if (seenNumbers.has(row.z)) {
    DATA_INVARIANT_PROBLEMS.push('дубликат атомного номера: ' + String(row.z));
  }
  if (seenSymbols.has(row.symbol)) {
    DATA_INVARIANT_PROBLEMS.push('дубликат символа: ' + row.symbol);
  }
  seenNumbers.add(row.z);
  seenSymbols.add(row.symbol);
}
for (let z = 1; z <= ELEMENT_COUNT; z += 1) {
  if (!seenNumbers.has(z)) {
    DATA_INVARIANT_PROBLEMS.push('IDENTIFICATION не содержит Z=' + String(z));
  }
}
if (STANDARD_ATOMIC_WEIGHTS.length !== ELEMENT_COUNT) {
  DATA_INVARIANT_PROBLEMS.push('STANDARD_ATOMIC_WEIGHTS: ' + String(STANDARD_ATOMIC_WEIGHTS.length));
}
if (ISOTOPIC_COMPOSITIONS.length !== ELEMENT_COUNT) {
  DATA_INVARIANT_PROBLEMS.push('ISOTOPIC_COMPOSITIONS: ' + String(ISOTOPIC_COMPOSITIONS.length));
}
if (POSITIONS.length !== ELEMENT_COUNT) {
  DATA_INVARIANT_PROBLEMS.push('POSITIONS: ' + String(POSITIONS.length));
}
if (CATEGORIES.length !== ELEMENT_COUNT) {
  DATA_INVARIANT_PROBLEMS.push('CATEGORIES: ' + String(CATEGORIES.length));
}
if (DATA_INVARIANT_PROBLEMS.length > 0) {
  throw new Error('Stage 4.3.3: инварианты данных элементов нарушены: ' + DATA_INVARIANT_PROBLEMS.join('; '));
}

// ============================================
// 4. СБОРКА СВОЙСТВ ЭЛЕМЕНТА
// ============================================

function footnotesNote(flags: string): string | undefined {
  const texts = flags.split('').map((f) => SAW_FOOTNOTES[f]).filter((t): t is string => t !== undefined);
  return texts.length === 0 ? undefined : texts.join('; ');
}

function asBlock(value: string): ElementBlock {
  if (!(ELEMENT_BLOCKS as readonly string[]).includes(value)) {
    throw new Error('Stage 4.3.3: неизвестный блок периодической таблицы: ' + value);
  }
  return value as ElementBlock;
}

function asCategory(value: string): ElementCategory {
  if (!(ELEMENT_CATEGORIES as readonly string[]).includes(value)) {
    throw new Error('Stage 4.3.3: неизвестная категория элемента: ' + value);
  }
  return value as ElementCategory;
}

/** Стандартный атомный вес CIAAW 2024 (безразмерный; не молярная масса). */
function standardAtomicWeightOf(z: number, symbol: string): StandardAtomicWeight {
  const row = STANDARD_ATOMIC_WEIGHTS.find((r) => r.startsWith(z + '|'));
  if (row === undefined) {
    throw new Error('Stage 4.3.3: нет строки стандартного атомного веса для Z=' + z);
  }
  const cells = row.split('|');
  const raw = cells[1] ?? '';
  const note = footnotesNote(cells[2] ?? '');
  const provenance: DataProvenance = { ...CIAAW_SAW_2024_PROVENANCE, recordId: 'ciaaw-saw-2024:Z=' + z + ' ' + symbol };
  if (raw === '—') {
    return { kind: 'not_assigned', reason: NOT_ASSIGNED_REASON, provenance };
  }
  if (raw.startsWith('[')) {
    const bounds = raw.slice(1, -1).split(',');
    return {
      kind: 'interval',
      lower: Number(bounds[0]),
      upper: Number(bounds[1]),
      rawNotation: raw,
      ...(note !== undefined ? { note } : {}),
      provenance
    };
  }
  const parsed = parseCiaawNumeric(raw);
  return {
    kind: 'value_with_uncertainty',
    value: parsed.value,
    uncertainty: parseCiaawBracketUncertainty(parsed.mantissa, parsed.brackets ?? '0'),
    rawNotation: raw,
    ...(note !== undefined ? { note } : {}),
    provenance
  };
}

/** Изотопный состав CIAAW 2024 (долевые распространённости). */
function isotopicCompositionOf(z: number, symbol: string): ElementIsotopicComposition {
  const row = ISOTOPIC_COMPOSITIONS.find((r) => r.startsWith(z + '|'));
  if (row === undefined) {
    return {
      status: 'unknown',
      reason: 'Stage 4.3.3: строка изотопного состава отсутствует в данных',
      provenance: { ...CIAAW_ISO_2024_PROVENANCE, recordId: 'ciaaw-iso-2024:Z=' + z + ' ' + symbol }
    };
  }
  const cells = row.split('|');
  const entries = cells[1] ?? '';
  const note = footnotesNote(cells[2] ?? '');
  const provenance: DataProvenance = { ...CIAAW_ISO_2024_PROVENANCE, recordId: 'ciaaw-iso-2024:Z=' + z + ' ' + symbol };
  if (entries === 'ABSENT') {
    return {
      status: 'not_applicable',
      reason: 'элемент отсутствует в таблице Isotopic Compositions of the Elements 2024: CIAAW не публикует изотопные распространённости для элементов без стандартного атомного веса при Z > 92; статус not_applicable, а не неизвестное число',
      ...(note !== undefined ? { note } : {}),
      provenance
    };
  }
  if (entries.startsWith('NA:')) {
    const massNumber = Number(entries.slice(3));
    return {
      status: 'not_applicable',
      reason: 'таблица CIAAW 2024 приводит для элемента только массовое число в скобках (' + massNumber + '): изотопные распространённости не назначаются; статус not_applicable, а не неизвестное число',
      ...(note !== undefined ? { note } : {}),
      provenance
    };
  }
  const records: IsotopeRecord[] = entries.split(';').map((entry): IsotopeRecord => {
    const parts = entry.split(':');
    const massNumber = Number(parts[0]);
    const raw = parts[1] ?? '';
    const recordId = 'ciaaw-iso-2024:Z=' + z + ' ' + symbol + ' A=' + massNumber;
    const recordProvenance: DataProvenance = { ...CIAAW_ISO_2024_PROVENANCE, recordId };
    if (raw.startsWith('[')) {
      const bounds = raw.slice(1, -1).split(',');
      return {
        massNumber,
        abundance: {
          kind: 'interval',
          lower: Number(bounds[0]),
          upper: Number(bounds[1]),
          rawNotation: raw,
          provenance: recordProvenance
        }
      };
    }
    const parsed = parseCiaawNumeric(raw);
    return {
      massNumber,
      abundance: {
        kind: 'value',
        value: parsed.value,
        uncertainty: parsed.brackets === null ? null : parseCiaawBracketUncertainty(parsed.mantissa, parsed.brackets),
        rawNotation: raw,
        provenance: recordProvenance
      }
    };
  });
  if (records.length === 0) {
    throw new Error('Stage 4.3.3: пустой список изотопных записей для Z=' + z);
  }
  return {
    status: 'known',
    ...(note !== undefined ? { note } : {}),
    provenance,
    records
  };
}

/** Положение в таблице IUPAC (группа 1–18 или null, период, блок или null). */
function positionOf(z: number, symbol: string): ElementPosition {
  const row = POSITIONS.find((r) => r.startsWith(z + '|'));
  if (row === undefined) {
    throw new Error('Stage 4.3.3: нет строки положения для Z=' + z);
  }
  const cells = row.split('|');
  const group = cells[1] === '-' ? null : Number(cells[1]);
  const period = Number(cells[2]);
  const block = cells[3] === '-' ? null : asBlock(cells[3] ?? '');
  const provenance: DataProvenance = { ...IUPAC_PT_2022_PROVENANCE, recordId: 'iupac-periodic-table-2022-05-04:Z=' + z + ' ' + symbol };
  return {
    group,
    ...(group === null ? { groupNotAssignedReason: GROUP3_REASON } : {}),
    period,
    block,
    ...(block === null ? { blockUnknownReason: BLOCK3_REASON } : {}),
    provenance
  };
}

/** Категория как отдельное свойство (known/unknown, с оговорками). */
function categoryOf(z: number, symbol: string): ElementCategoryProperty {
  const row = CATEGORIES.find((r) => r.startsWith(z + '|'));
  if (row === undefined) {
    throw new Error('Stage 4.3.3: нет строки категории для Z=' + z);
  }
  const value = row.split('|')[1] ?? '';
  const provenance: DataProvenance = { ...CATEGORY_PROVENANCE, recordId: 'element-categories-editorial:Z=' + z + ' ' + symbol };
  if (value === '-') {
    return {
      status: 'unknown',
      category: null,
      unknownReason: 'для сверхтяжёлого элемента (Z=104–118) общепринятая экспериментально подтверждённая категория отсутствует: физико-химические свойства изучены фрагментарно; категория не выбирается молча',
      provenance
    };
  }
  const note = CATEGORY_NOTES[z];
  return {
    status: 'known',
    category: asCategory(value),
    ...(note !== undefined ? { notes: [note] } : {}),
    provenance
  };
}

/** Числовое атомное свойство без подтверждённого источника — unknown. */
function unknownAtomicProperty(property: string, z: number, symbol: string): ScientificValue {
  return unknownValue(
    'значение не импортировано в Stage 4.3.3: источник с подтверждённой лицензией на распространение не подключён (права NIST SRD не подтверждены); unknown НЕ равен нулю',
    { ...UNKNOWN_PROPERTY_PROVENANCE, recordId: 'stage-4-3-3-unknown:Z=' + z + ' ' + symbol + ' ' + property }
  );
}

/** Строковое атомное свойство без подтверждённого источника — unknown. */
function unknownStringProperty(property: string, z: number, symbol: string): ElementStringProperty {
  return {
    status: 'unknown',
    unknownReason: 'значение не импортировано в Stage 4.3.3: источник с подтверждённой лицензией на распространение не подключён (права NIST SRD не подтверждены); свойство не выдумывается',
    provenance: { ...UNKNOWN_PROPERTY_PROVENANCE, recordId: 'stage-4-3-3-unknown:Z=' + z + ' ' + symbol + ' ' + property }
  };
}

// ============================================
// 5. СБОРКА ЭЛЕМЕНТА И КАТАЛОГА
// ============================================

/**
 * Сборка ChemicalElement из зафиксированных таблиц. Детерминирована:
 * одни и те же таблицы дают одинаковые записи.
 */
export function buildElement(z: number): ChemicalElement {
  const ident = IDENT_ROWS.find((r) => r.z === z);
  if (ident === undefined) {
    throw new Error('Stage 4.3.3: в данных нет элемента Z=' + z);
  }
  const iupacRecordId = 'iupac-periodic-table-2022-05-04:Z=' + z + ' ' + ident.symbol;
  return {
    atomicNumber: z,
    symbol: ident.symbol,
    nameEnglish: ident.nameEnglish,
    nameEnglishProvenance: { ...IUPAC_PT_2022_PROVENANCE, recordId: iupacRecordId },
    nameRussian: ident.nameRussian,
    nameRussianProvenance: { ...RU_NOMENCLATURE_PROVENANCE, recordId: 'ru-element-nomenclature-editorial:Z=' + z + ' ' + ident.symbol },
    position: positionOf(z, ident.symbol),
    category: categoryOf(z, ident.symbol),
    standardAtomicWeight: standardAtomicWeightOf(z, ident.symbol),
    isotopicComposition: isotopicCompositionOf(z, ident.symbol),
    representativeIsotopeCandidates: buildRepresentativeCandidates(z, ident.symbol),
    electronConfiguration: unknownStringProperty('electronConfiguration', z, ident.symbol),
    firstIonizationEnergy: unknownAtomicProperty('firstIonizationEnergy', z, ident.symbol),
    electronAffinity: unknownAtomicProperty('electronAffinity', z, ident.symbol),
    electronegativity: unknownAtomicProperty('electronegativity', z, ident.symbol),
    atomicRadius: unknownAtomicProperty('atomicRadius', z, ident.symbol),
    meltingPoint: unknownAtomicProperty('meltingPoint', z, ident.symbol),
    boilingPoint: unknownAtomicProperty('boilingPoint', z, ident.symbol),
    density: unknownAtomicProperty('density', z, ident.symbol),
    oxidationStates: unknownStringProperty('oxidationStates', z, ident.symbol),
    provenance: {
      ...IUPAC_PT_2022_PROVENANCE,
      recordId: iupacRecordId,
      note: 'происхождение идентификации записи; происхождения конкретных значений — в соответствующих полях записи'
    }
  };
}

/**
 * Каталог всех 118 элементов. Регистрация валидирует каждую запись
 * (встроенная runtime-проверка данных) и отклоняет дубликаты Z/symbol.
 */
export function buildElementCatalog(): ElementCatalog {
  const catalog = createElementCatalog();
  for (let z = 1; z <= ELEMENT_COUNT; z += 1) {
    catalog.register(buildElement(z));
  }
  return catalog;
}

// ============================================
// 6. ФАКТИЧЕСКОЕ ПОКРЫТИЕ ДАННЫХ
// ============================================

/** Счётчики фактического заполнения каталога (для тестов и документации). */
export interface ElementCatalogCoverage {
  elements: number;
  standardAtomicWeightsInterval: number;
  standardAtomicWeightsValueWithUncertainty: number;
  standardAtomicWeightsNotAssigned: number;
  isotopicKnown: number;
  isotopicNotApplicable: number;
  isotopeRecords: number;
  categoryKnown: number;
  categoryUnknown: number;
  groupNotAssigned: number;
  blockNotAssigned: number;
  candidateElements: number;
  candidateNuclides: number;
  candidateIsomericStates: number;
  candidateCompleteElements: number;
  candidateIncompleteElements: number;
  numericKnown: number;
  numericUnknown: number;
  stringUnknown: number;
}

export function elementCatalogCoverage(): ElementCatalogCoverage {
  const elements = buildElementCatalog().list();
  let standardAtomicWeightsInterval = 0;
  let standardAtomicWeightsValueWithUncertainty = 0;
  let standardAtomicWeightsNotAssigned = 0;
  let isotopicKnown = 0;
  let isotopicNotApplicable = 0;
  let isotopeRecords = 0;
  let categoryKnown = 0;
  let categoryUnknown = 0;
  let groupNotAssigned = 0;
  let blockNotAssigned = 0;
  let candidateElements = 0;
  let candidateNuclides = 0;
  let candidateIsomericStates = 0;
  let candidateCompleteElements = 0;
  let candidateIncompleteElements = 0;
  let numericKnown = 0;
  let numericUnknown = 0;
  let stringUnknown = 0;
  for (const element of elements) {
    const weight = element.standardAtomicWeight;
    if (weight.kind === 'interval') {
      standardAtomicWeightsInterval += 1;
    } else if (weight.kind === 'value_with_uncertainty') {
      standardAtomicWeightsValueWithUncertainty += 1;
    } else {
      standardAtomicWeightsNotAssigned += 1;
    }
    const iso = element.isotopicComposition;
    if (iso.status === 'known') {
      isotopicKnown += 1;
      isotopeRecords += iso.records?.length ?? 0;
    } else if (iso.status === 'not_applicable') {
      isotopicNotApplicable += 1;
    }
    if (element.category.status === 'known') {
      categoryKnown += 1;
    } else {
      categoryUnknown += 1;
    }
    if (element.position.group === null) {
      groupNotAssigned += 1;
    }
    if (element.position.block === null) {
      blockNotAssigned += 1;
    }
    const candidates = element.representativeIsotopeCandidates;
    if (candidates.status === 'known') {
      candidateElements += 1;
      const list = candidates.candidates ?? [];
      candidateNuclides += list.length;
      for (const candidate of list) {
        if (candidate.state === 'isomeric') {
          candidateIsomericStates += 1;
        }
      }
      if (candidates.completeness === 'complete') {
        candidateCompleteElements += 1;
      } else {
        candidateIncompleteElements += 1;
      }
    }
    const numeric: ScientificValue[] = [
      element.firstIonizationEnergy,
      element.electronAffinity,
      element.electronegativity,
      element.atomicRadius,
      element.meltingPoint,
      element.boilingPoint,
      element.density
    ];
    for (const value of numeric) {
      if (value.status === 'known' || value.status === 'estimated') {
        numericKnown += 1;
      } else if (value.status === 'unknown') {
        numericUnknown += 1;
      }
    }
    if (element.electronConfiguration.status === 'unknown') {
      stringUnknown += 1;
    }
    if (element.oxidationStates.status === 'unknown') {
      stringUnknown += 1;
    }
  }
  return {
    elements: elements.length,
    standardAtomicWeightsInterval,
    standardAtomicWeightsValueWithUncertainty,
    standardAtomicWeightsNotAssigned,
    isotopicKnown,
    isotopicNotApplicable,
    isotopeRecords,
    categoryKnown,
    categoryUnknown,
    groupNotAssigned,
    blockNotAssigned,
    candidateElements,
    candidateNuclides,
    candidateIsomericStates,
    candidateCompleteElements,
    candidateIncompleteElements,
    numericKnown,
    numericUnknown,
    stringUnknown
  };
}
