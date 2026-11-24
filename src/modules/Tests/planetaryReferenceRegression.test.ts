/**
 * Stage 4.2 — независимая планетарная регрессия Mars reference case.
 *
 * Источники ожидаемых значений:
 * - NASA/NSSDC Mars Fact Sheet: https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html
 *   (J2000 a = 1.52366231 AU; mean surface pressure = 6.36 mbar;
 *   atmosphere CO2 95.1%, N2 2.59%, Ar 1.94%, O2 0.16%, CO 0.06%;
 *   average temperature approximately 214 K).
 * - NASA Planetary Fact Sheet, metric: https://nssdc.gsfc.nasa.gov/planetary/factsheet/
 *   (Mars mass approximately 0.642 × 10^24 kg; gravity approximately 3.7 m/s²).
 * - ESA Mars Express facts: https://www.esa.int/et/articles/about-us/directorates/science/mars-express/facts-about-mars
 *   (gravity 3.711 m/s²; average solar distance 227.94 million km;
 *   average surface pressure 6.35 mbar).
 *
 * The repository's Mars preset is a rounded legacy preset (0.006 atm,
 * CO2 95%, N2 2.7%, Ar 1.6%, O2 0.13%, CO 0.06%). Assertions therefore
 * use explicit tolerances and do not silently rewrite the historical data.
 * This is an independent subsystem regression, not a claim that the
 * atmospheric chemistry or vertical structure is fully modelled.
 */

import { describe, expect, it } from 'vitest';
import { computeAtmospherePhysicalModel, getAllPresets } from '../Atmosphere';
import {
  equilibriumTemperature,
  incidentFlux,
  orbitalPeriodFromElements
} from '../OrbitalMechanics';
import { AU_M, G, L_SUN_W, M_SUN_KG } from '../Units';

const MARS_REFERENCE = {
  massKg: 0.64169e24,
  meanRadiusM: 3389.5e3,
  semimajorAxisAu: 1.52366231,
  meanGravityMs2: 3.73,
  meanDensityKgM3: 3934,
  incidentSolarFluxWm2: 586.2,
  bondAlbedo: 0.25,
  equilibriumTemperatureK: 209.8,
  siderealYearDays: 686.98,
  meanSurfacePressurePa: 636,
  atmosphericMoleFractions: {
    co2: 0.951,
    n2: 0.0259,
    ar: 0.0194,
    o2: 0.0016,
    co: 0.0006
  }
} as const;

describe('Stage 4.2: independent planetary reference regression — Mars', () => {
  it('derives Mars gravity and bulk density from independent mass/radius references', () => {
    const gravity = (G * MARS_REFERENCE.massKg) / MARS_REFERENCE.meanRadiusM ** 2;
    const volumeM3 = (4 / 3) * Math.PI * MARS_REFERENCE.meanRadiusM ** 3;
    const density = MARS_REFERENCE.massKg / volumeM3;

    expect(gravity).toBeCloseTo(MARS_REFERENCE.meanGravityMs2, 1);
    expect(gravity).toBeCloseTo(3.711, 1); // Independent ESA reference.
    expect(density).toBeCloseTo(MARS_REFERENCE.meanDensityKgM3, 0);
  });

  it('reproduces the published Mars solar flux, grey-body equilibrium temperature and orbital period', () => {
    const semimajorAxisM = MARS_REFERENCE.semimajorAxisAu * AU_M;
    const flux = incidentFlux(L_SUN_W, semimajorAxisM);

    expect(flux).not.toBeNull();
    expect(flux as number).toBeCloseTo(MARS_REFERENCE.incidentSolarFluxWm2, 0);

    const equilibriumK = equilibriumTemperature(flux, {
      bondAlbedo: MARS_REFERENCE.bondAlbedo,
      emissivity: 1,
      redistribution: 1
    });
    expect(equilibriumK).not.toBeNull();
    expect(equilibriumK as number).toBeCloseTo(MARS_REFERENCE.equilibriumTemperatureK, 0);

    const periodS = orbitalPeriodFromElements(semimajorAxisM, M_SUN_KG);
    expect(periodS).not.toBeNull();
    expect((periodS as number) / 86400).toBeCloseTo(MARS_REFERENCE.siderealYearDays, 0);
  });

  it('keeps the Mars atmospheric reference within the documented legacy-preset rounding envelope', () => {
    const marsPreset = getAllPresets()['mars'];
    expect(marsPreset).toBeDefined();

    const gravity = (G * MARS_REFERENCE.massKg) / MARS_REFERENCE.meanRadiusM ** 2;
    const atmosphere = computeAtmospherePhysicalModel(marsPreset!, {
      surfaceGravityMs2: gravity
    });

    const modelPressurePa = atmosphere.surfacePressurePa?.value;
    expect(modelPressurePa).not.toBeNull();
    const pressureRelativeError =
      Math.abs((modelPressurePa as number) - MARS_REFERENCE.meanSurfacePressurePa) /
      MARS_REFERENCE.meanSurfacePressurePa;
    // Legacy preset uses 0.006 atm = 607.95 Pa; NASA reference is 636 Pa.
    expect(pressureRelativeError).toBeLessThan(0.05);

    for (const [speciesId, expected] of Object.entries(MARS_REFERENCE.atmosphericMoleFractions)) {
      const actual = atmosphere.molarFractions[speciesId];
      expect(actual, speciesId + ' should be present').toBeDefined();
      // Catalog values are rounded and normalized by the model. Use a
      // 0.5 percentage-point tolerance against the independent fact sheet.
      expect(Math.abs((actual as number) - expected)).toBeLessThan(0.005);
    }

    const columnMass = atmosphere.columnMassKgM2?.value;
    expect(columnMass).not.toBeNull();
    expect(columnMass as number).toBeCloseTo((modelPressurePa as number) / gravity, 8);
  });

  it('does not mistake the Mars surface-boundary datum for a vertical atmospheric profile', () => {
    const atmosphere = computeAtmospherePhysicalModel(getAllPresets()['mars']!);
    expect(atmosphere.layers).toHaveLength(1);
    expect(atmosphere.layers[0]?.layerId).toBe('surface_boundary');
    expect(atmosphere.layers[0]?.altitudeRangeM?.max ?? null).toBeNull();
    expect(atmosphere.layersNote).toContain('Полный профиль');
  });
});
