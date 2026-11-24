import type { DataProvenance } from '../Core/scientificValue';

// ============================================
// MGS MARS RADIO-OCCULTATION PROFILE: 8028D38A.TPS
// ============================================
//
// Source-backed single-occultation sample from the NASA Planetary Data
// System, MGS-M-RSS-5-TPS-V1.0. The 74 table rows below are transcribed
// from the original PDS3 ASCII product. They are retrieval products,
// not raw sensor temperatures: P/T were derived assuming hydrostatic
// balance and the ideal-gas law; number density was retrieved from
// refractivity using a Viking-era atmospheric-composition assumption.
//
// Dataset DOI: https://doi.org/10.17189/n719-8n94
// PDS product label:
// https://atmos.nmsu.edu/PDS/data/mors_1101/tps/1998_028/8028d38a.lbl
// PDS product:
// https://atmos.nmsu.edu/PDS/data/mors_1101/tps/1998_028/8028d38a.tps
//
// Do not treat this single local-time/latitude/season sample as a global
// Mars climatology. The PDS header's surface pressure is an extrapolation
// from the lowest retrieved sample; the hydrostatic adapter deliberately
// anchors at the first measured row instead of pretending that this
// extrapolated value is a direct surface measurement.

export interface MgsMarsOccultationSample {
  /** PDS table row number (1-based). */
  readonly rowNumber: number;
  /** Measurement radius, m, from the Mars center of mass. */
  readonly radiusM: number;
  /** PDS geopotential after subtraction of the header reference, m²/s². */
  readonly geopotentialM2S2: number;
  readonly pressurePa: number;
  readonly pressureSigmaPa: number;
  readonly temperatureK: number;
  readonly temperatureSigmaK: number;
  readonly numberDensityPerM3: number;
  readonly numberDensitySigmaPerM3: number;
  /** Derived geometric height above the occultation's local radius-at-surface. */
  readonly heightAboveLocalSurfaceM: number;
}

export const MGS_MARS_8028D38A_METADATA = {
  profileId: 'mgs-mars-1998-028-8028d38a',
  productId: '8028D38A.TPS',
  datasetId: 'MGS-M-RSS-5-TPS-V1.0',
  datasetDoi: '10.17189/n719-8n94',
  target: 'MARS',
  startTimeUtc: '1998-01-28T03:38:00.000Z',
  stopTimeUtc: '1998-01-28T03:51:00.000Z',
  occultationTimeUtc: '1998-01-28T03:30:14.324Z',
  latitudeDegNorth: 29.213,
  longitudeDegEast: 56.774,
  localTrueSolarTimeHours: 5.727,
  solarLongitudeDeg: 24.2,
  solarZenithAngleDeg: 105.35,
  /** PDS header: local radius at occultation point, not a global mean radius. */
  radiusAtSurfaceM: 3392207,
  /** PDS header value extrapolated to the surface from the lowest profile sample. */
  extrapolatedSurfacePressurePa: 594.23,
  extrapolatedSurfacePressureSigmaPa: 7.25,
  gravityFieldModelUsedByRetrieval: 'GGM50A02.SHA',
  geopotentialReferenceM2S2: 12652778,
  rowCount: 74
} as const;

export const MGS_MARS_8028D38A_PROVENANCE: DataProvenance = {
  sourceName: 'Mars Global Surveyor Radio Science Team, reduced radio-occultation T-P profile',
  sourceId: 'PDS product 8028D38A.TPS',
  datasetId: 'MGS-M-RSS-5-TPS-V1.0',
  datasetVersion: '1.0',
  reference: 'https://doi.org/10.17189/n719-8n94',
  retrievedAt: '2026-11-24',
  method:
    'PDS3 RSTP retrieval from Mars Global Surveyor radio occultation; refractivity inverted to number density, then pressure and temperature derived assuming hydrostatic balance and the ideal-gas law',
  applicability:
    'single Mars occultation on 1998-01-28 at 29.213° N, 56.774° E and local true solar time 5.727 h; retrieved profile spans the rows in product 8028D38A.TPS',
  limitations:
    'P/T are retrieved quantities rather than direct in-situ thermometer readings; retrieval uses an atmospheric-composition assumption based on Viking measurements and a gravity-field model GGM50A02.SHA. This is one spatial/temporal sample, not a global or climatological Mars profile. The Core adapter uses spherical gravity and must not be confused with the retrieval gravity model.',
  conditions:
    'Occultation time 1998-01-28T03:30:14.324Z; areocentric latitude 29.213° N; east longitude 56.774°; local true solar time 5.727 h; solar zenith angle 105.35°',
  license: 'NASA Planetary Data System public science archive; retain PDS citation and product identifier',
  note:
    'The PDS header surface pressure 594.23 ± 7.25 Pa is extrapolated from the lowest retrieved sample. The hydrostatic adapter anchors at the first actual table row instead.'
};

type RawMgsRow = readonly [
  radiusM: number,
  geopotentialM2S2: number,
  pressurePa: number,
  pressureSigmaPa: number,
  temperatureK: number,
  temperatureSigmaK: number,
  numberDensityPerM3: number,
  numberDensitySigmaPerM3: number
];

// The table has 10 PDS columns. This compact source snapshot retains
// radius, geopotential, pressure, sigma-pressure, temperature,
// sigma-temperature, number density and sigma-number-density.
// Per-row latitude/longitude are omitted; the header occultation
// coordinates are retained in MGS_MARS_8028D38A_METADATA.
const RAW_MGS_ROWS: readonly RawMgsRow[] = [
  [3392456.6, 1285, 5.79820e2, 7.16, 1.98138e2, 1.85, 2.11953e23, 6.64e20],
  [3392762.0, 2392, 5.63307e2, 7.11, 2.02402e2, 1.91, 2.01578e23, 6.64e20],
  [3393162.8, 3852, 5.42529e2, 7.04, 2.04364e2, 1.97, 1.92280e23, 6.64e20],
  [3393567.2, 5326, 5.22518e2, 6.97, 2.05746e2, 2.03, 1.83944e23, 6.64e20],
  [3394004.7, 6922, 5.01769e2, 6.90, 2.06440e2, 2.09, 1.76045e23, 6.64e20],
  [3394431.7, 8479, 4.82426e2, 6.83, 2.07600e2, 2.15, 1.68313e23, 6.64e20],
  [3394854.9, 10021, 4.64079e2, 6.75, 2.08697e2, 2.21, 1.61061e23, 6.64e20],
  [3395282.5, 11579, 4.46327e2, 6.68, 2.09212e2, 2.27, 1.54518e23, 6.64e20],
  [3395735.6, 13232, 4.28259e2, 6.60, 2.09082e2, 2.32, 1.48355e23, 6.64e20],
  [3396182.8, 14862, 4.11155e2, 6.53, 2.09550e2, 2.38, 1.42113e23, 6.64e20],
  [3396620.2, 16455, 3.95160e2, 6.45, 2.10335e2, 2.45, 1.36075e23, 6.64e20],
  [3397062.3, 18065, 3.79657e2, 6.38, 2.10731e2, 2.51, 1.30490e23, 6.64e20],
  [3397512.3, 19705, 3.64529e2, 6.30, 2.10766e2, 2.57, 1.25270e23, 6.64e20],
  [3397963.9, 21349, 3.49945e2, 6.22, 2.10639e2, 2.63, 1.20330e23, 6.64e20],
  [3398423.2, 23022, 3.35691e2, 6.15, 2.10387e2, 2.69, 1.15567e23, 6.64e20],
  [3398874.3, 24664, 3.22261e2, 6.07, 2.10305e2, 2.76, 1.10987e23, 6.64e20],
  [3399340.7, 26363, 3.08915e2, 5.99, 2.09748e2, 2.82, 1.06673e23, 6.64e20],
  [3399801.6, 28040, 2.96259e2, 5.91, 2.09771e2, 2.89, 1.02292e23, 6.63e20],
  [3400255.5, 29691, 2.84311e2, 5.84, 2.09832e2, 2.96, 9.81376e22, 6.62e20],
  [3400725.1, 31400, 2.72445e2, 5.76, 2.09241e2, 3.02, 9.43075e22, 6.60e20],
  [3401190.4, 33092, 2.61159e2, 5.68, 2.09068e2, 3.10, 9.04756e22, 6.59e20],
  [3401655.9, 34785, 2.50326e2, 5.60, 2.08884e2, 3.17, 8.67989e22, 6.57e20],
  [3402126.8, 36497, 2.39814e2, 5.52, 2.08690e2, 3.25, 8.32314e22, 6.56e20],
  [3402589.9, 38180, 2.29911e2, 5.45, 2.08727e2, 3.32, 7.97804e22, 6.54e20],
  [3403066.0, 39910, 2.20142e2, 5.37, 2.07998e2, 3.39, 7.66583e22, 6.52e20],
  [3403550.2, 41670, 2.10611e2, 5.29, 2.07897e2, 3.48, 7.33749e22, 6.51e20],
  [3404016.8, 43365, 2.01858e2, 5.21, 2.09666e2, 3.57, 6.97319e22, 6.49e20],
  [3404474.1, 45024, 1.93703e2, 5.13, 2.11517e2, 3.66, 6.63290e22, 6.48e20],
  [3404941.0, 46719, 1.85760e2, 5.06, 2.11831e2, 3.74, 6.35149e22, 6.46e20],
  [3405420.9, 48461, 1.77928e2, 4.98, 2.10968e2, 3.82, 6.10860e22, 6.45e20],
  [3405903.3, 50212, 1.70356e2, 4.90, 2.10230e2, 3.89, 5.86917e22, 6.43e20],
  [3406383.3, 51953, 1.63129e2, 4.83, 2.10029e2, 3.97, 5.62558e22, 6.42e20],
  [3406860.2, 53683, 1.56249e2, 4.75, 2.09952e2, 4.06, 5.39026e22, 6.40e20],
  [3407340.0, 55423, 1.49613e2, 4.67, 2.09201e2, 4.13, 5.17989e22, 6.38e20],
  [3407828.4, 57194, 1.43114e2, 4.59, 2.07859e2, 4.21, 4.98686e22, 6.37e20],
  [3408310.6, 58941, 1.36944e2, 4.52, 2.06824e2, 4.29, 4.79572e22, 6.35e20],
  [3408806.2, 60738, 1.30839e2, 4.44, 2.05176e2, 4.36, 4.61876e22, 6.33e20],
  [3409291.4, 62496, 1.25106e2, 4.36, 2.05160e2, 4.45, 4.41671e22, 6.32e20],
  [3409772.7, 64239, 1.19666e2, 4.29, 2.04886e2, 4.54, 4.23033e22, 6.30e20],
  [3410266.2, 66026, 1.14309e2, 4.21, 2.03308e2, 4.61, 4.07230e22, 6.28e20],
  [3410756.5, 67801, 1.09194e2, 4.13, 2.02272e2, 4.70, 3.91002e22, 6.27e20],
  [3411248.8, 69583, 1.04262e2, 4.06, 2.00931e2, 4.78, 3.75832e22, 6.25e20],
  [3411748.1, 71390, 9.94598e1, 3.98, 1.99796e2, 4.86, 3.60557e22, 6.23e20],
  [3412235.9, 73154, 9.49744e1, 3.90, 2.00283e2, 4.96, 3.43460e22, 6.22e20],
  [3412726.3, 74928, 9.06730e1, 3.83, 1.99791e2, 5.05, 3.28712e22, 6.20e20],
  [3413225.8, 76734, 8.64727e1, 3.75, 1.98357e2, 5.14, 3.15751e22, 6.18e20],
  [3413722.2, 78528, 8.24734e1, 3.68, 1.97893e2, 5.23, 3.01854e22, 6.16e20],
  [3414215.6, 80311, 7.86738e1, 3.60, 1.97511e2, 5.33, 2.88505e22, 6.15e20],
  [3414713.0, 82108, 7.50019e1, 3.53, 1.95742e2, 5.41, 2.77525e22, 6.13e20],
  [3415222.0, 83947, 7.13862e1, 3.45, 1.93459e2, 5.49, 2.67263e22, 6.11e20],
  [3415719.4, 85743, 6.80042e1, 3.38, 1.93571e2, 5.60, 2.54454e22, 6.09e20],
  [3416223.5, 87563, 6.47411e1, 3.31, 1.93411e2, 5.70, 2.42445e22, 6.08e20],
  [3416722.1, 89363, 6.16766e1, 3.23, 1.94964e2, 5.82, 2.29128e22, 6.06e20],
  [3417216.0, 91145, 5.88082e1, 3.16, 1.96153e2, 5.94, 2.17149e22, 6.04e20],
  [3417723.8, 92976, 5.59953e1, 3.09, 1.94772e2, 6.03, 2.08228e22, 6.02e20],
  [3418224.0, 94780, 5.33470e1, 3.02, 1.94507e2, 6.14, 1.98650e22, 6.00e20],
  [3418733.1, 96616, 5.07640e1, 2.94, 1.92441e2, 6.23, 1.91061e22, 5.99e20],
  [3419240.9, 98446, 4.82969e1, 2.87, 1.91781e2, 6.34, 1.82401e22, 5.97e20],
  [3419742.2, 100252, 4.59730e1, 2.80, 1.91323e2, 6.45, 1.74040e22, 5.95e20],
  [3420256.1, 102104, 4.36860e1, 2.73, 1.88137e2, 6.54, 1.68183e22, 5.93e20],
  [3420764.5, 103935, 4.15100e1, 2.66, 1.86524e2, 6.66, 1.61187e22, 5.91e20],
  [3421277.1, 105781, 3.94039e1, 2.59, 1.84099e2, 6.77, 1.55025e22, 5.89e20],
  [3421786.2, 107614, 3.73907e1, 2.52, 1.81448e2, 6.89, 1.49254e22, 5.88e20],
  [3422309.9, 109499, 3.53931e1, 2.45, 1.77442e2, 6.99, 1.44470e22, 5.86e20],
  [3422820.7, 111336, 3.35341e1, 2.39, 1.78832e2, 7.21, 1.35817e22, 5.84e20],
  [3423331.3, 113173, 3.17895e1, 2.32, 1.80672e2, 7.45, 1.27440e22, 5.82e20],
  [3423839.4, 115000, 3.01554e1, 2.25, 1.81390e2, 7.69, 1.20411e22, 5.80e20],
  [3424358.9, 116867, 2.85623e1, 2.19, 1.78534e2, 7.86, 1.15874e22, 5.78e20],
  [3424876.5, 118727, 2.70458e1, 2.12, 1.77794e2, 8.11, 1.10178e22, 5.76e20],
  [3425392.9, 120583, 2.56089e1, 2.06, 1.77747e2, 8.41, 1.04353e22, 5.74e20],
  [3425911.9, 122447, 2.42433e1, 2.00, 1.78016e2, 8.76, 9.86385e21, 5.72e20],
  [3426427.6, 124299, 2.29650e1, 1.94, 1.79529e2, 9.19, 9.26501e21, 5.70e20],
  [3426947.8, 126166, 2.17498e1, 1.87, 1.79600e2, 9.56, 8.77129e21, 5.68e20],
  [3427466.4, 128028, 2.06034e1, 1.81, 1.80000e2, 10.00, 8.29050e21, 5.66e20]
];

export const MGS_MARS_8028D38A_SAMPLES: readonly MgsMarsOccultationSample[] =
  Object.freeze(
    RAW_MGS_ROWS.map((row, index) => ({
      rowNumber: index + 1,
      radiusM: row[0],
      geopotentialM2S2: row[1],
      pressurePa: row[2],
      pressureSigmaPa: row[3],
      temperatureK: row[4],
      temperatureSigmaK: row[5],
      numberDensityPerM3: row[6],
      numberDensitySigmaPerM3: row[7],
      heightAboveLocalSurfaceM: row[0] - MGS_MARS_8028D38A_METADATA.radiusAtSurfaceM
    }))
  );
