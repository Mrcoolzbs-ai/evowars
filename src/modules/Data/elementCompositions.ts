// ============================================
// ELEMENT COMPOSITIONS - Элементный состав веществ
// ============================================
//
// Число атомов каждого элемента в молекуле.
// Используется для автоматической проверки элементного баланса
// химических реакций: атомы не могут возникать из ничего
// или исчезать.
//
// Составы — установленные химические формулы (established).
// 'unidentified' намеренно отсутствует: баланс с неизвестным
// составом проверить невозможно.

export interface ElementComposition {
  formula: string;
  elements: Record<string, number>;
}

export const elementCompositions: Record<string, ElementComposition> = {
  ch4: { formula: 'CH4', elements: { C: 1, H: 4 } },
  n2: { formula: 'N2', elements: { N: 2 } },
  c2h6: { formula: 'C2H6', elements: { C: 2, H: 6 } },
  h2: { formula: 'H2', elements: { H: 2 } },
  nh3: { formula: 'NH3', elements: { N: 1, H: 3 } },
  co: { formula: 'CO', elements: { C: 1, O: 1 } },
  co2: { formula: 'CO2', elements: { C: 1, O: 2 } },
  h2o: { formula: 'H2O', elements: { H: 2, O: 1 } },
  o2: { formula: 'O2', elements: { O: 2 } },
  so2: { formula: 'SO2', elements: { S: 1, O: 2 } },
  he: { formula: 'He', elements: {} },
  ar: { formula: 'Ar', elements: {} },
  ne: { formula: 'Ne', elements: {} }
};

/**
 * Получить элементный состав вещества.
 * null — состав неизвестен (например, 'unidentified').
 */
export function getElementComposition(gasId: string): ElementComposition | null {
  return elementCompositions[gasId] ?? null;
}

export default elementCompositions;
