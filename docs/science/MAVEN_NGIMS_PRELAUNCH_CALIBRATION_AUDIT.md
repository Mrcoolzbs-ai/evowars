# MAVEN/NGIMS pre-launch calibration evidence audit — Stage 4.2.2

**Status: source audit in progress; SIS/PDS inventory verified; raw calibration science products not yet fully audited; no calibration constants promoted.**  
Review date: 2026-11-27. Scope: evidence identification and applicability, not numerical calibration.

## 1. Primary references

1. **NGIMS PDS Software Interface Specification (SIS), Rev. 1.3, 2015-05-22.** [PDF](https://lasp.colorado.edu/galaxy/download/attachments/26250002/NGIMS%20PDS%20SIS%20rev%201.3_MKE.pdf?amp%3Bapi=v2&amp%3BmodificationDate=1454626397265&version=1)
   - §3.7 Instrument Calibration; detector-chain characterization, noise, chemical background, sensitivity, closed-source ram enhancement.
   - Appendix A, §8.4 / Table A-11 lists calibration TIDs and says data are archived raw in the calibration collection; post-launch TIDs are in L1A/L1B collections.
   - §8.3 defines product fields. L1B calibrated products are instrument-calibrated data, while L2 abundance products apply additional background, pointing and ram-related corrections.
2. **PDS NGIMS calibration collection record.** [PDS Collection](https://pds.nasa.gov/ds-view/pds/viewCollection.jsp?identifier=urn%3Anasa%3Apds%3Amaven_ngims%3Al1b)
   - PDS describes the collection as raw pre-launch Integration and Testing data used to define calibration techniques for flight data. This collection's existence does not itself constitute calibration evidence.
3. **PDS Atmospheres NGIMS archive portal.** [Archive & data access](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims.html)
   - Offers calibrated/L1B products and associated cal-hk, cal-mkr, cal-msg housekeeping products; documents data retrieval via index and URN.
4. **Instrument overview paper (Mahaffy et al., 2014).** [PDF](https://lasp.colorado.edu/maven/files/2014/10/MAVEN_NGIMS.pdf)
   - Instrument calibration used a static chamber and calibration gases; response characterized over pressure range; calibration configurations paired CS/OS filaments and CEMs. This is general context, not a substitute for event files.

## 2. Calibration event candidates from SIS Table A-11

| TID | Date (SIS) | Operation | Atmosphere / temp | Script | Intended audit |
|---|---|---|---|---|---|
| 10191 | 2012-09-23 | Argon calibration | Ambient | cal_script.bas | Inspect raw science + HK + marker + log; pressure and response |
| 10194 | 2012-09-23 | Krypton calibration | Ambient | cal_script.bas | Same; identify masses, pressure, detector/config |
| 10197 | 2012-09-24 | Krypton calibration | Ambient | cal_script.bas | Compare repeated calibration run |
| 10198 | 2012-09-24 | Krypton calibration | Ambient | cal_script.bas | Repeatability / event differences |
| 10199 | 2012-09-25 | Krypton calibration | Ambient | cal_script.bas | Track later configuration |
| 10201 | 2012-09-25 | Xenon calibration | Ambient | cal_script.bas | Xenon mass response |
| 10202 | 2012-09-25 | Xenon calibration | Ambient | cal_script.bas | Repeat / compare |
| 10205 | 2012-09-26 | Helium calibration | Ambient | cal_script.bas | Low-mass response |
| 10207 | 2012-09-26 | Helium calibration | Ambient | cal_script.bas | Repeat / compare |
| 10216 | 2012-09-28 | CS/OS switching test | Ambient | OS_CS_test.bas | Switching/config behavior; not standalone sensitivity |
| 10217 | 2012-09-28 | CS/OS switching test | Ambient | OS_CS_test.bas | Repeat / compare |
| 10241 | SIS lists 2012-03-10 | Pre pinch-off | Ambient | cal_script.bas | Treat date anomaly as source issue; inspect labels |
| 10242 | SIS lists 2012-03-10 | Post pinch-off | Ambient | cal_script.bas | Paired before/after; inspect provenance and exact event |

**Date caveat:** the SIS table's last two rows have an anomalous date relative to the preceding September 2012 sequence. Do not silently normalize dates; product labels and archive inventory must resolve this.

## 3. Evidence stages and policy

- **Stage A — inventory:** locate each TID's science, housekeeping, marker, and message products; capture product IDs, filenames, labels, byte sizes, records, version/revision, hashes.
- **Stage B — event integrity:** verify matched TID/event across products; no timestamp joins across instrument clocks unless documented correlation is established.
- **Stage C — descriptive characterization:** parse raw CPS vs mass, gas, pressure (if documented), operating configuration, filament/emission, CEM, temperature, and event sequence. Preserve raw counts and empty fields; no interpolation.
- **Stage D — numerical calibration:** only after source quantities, chamber pressure/mixture, standards, instrument config and response corrections are independently verified. Derive fits with uncertainty, repeatability, residuals, and fit-domain boundaries.
- **Stage E — flight applicability:** ground calibration may inform calibration models but does not validate flight-specific sensitivity, energy correction (C_EN), background, detector dead time, or conversion coefficients. Requires flight-event-specific evidence and independent validation.
- Never use ambient-pressure ground chamber response as a Mars ambient-density conversion without the documented calibration equation, gas-flow/pressure metadata, species-specific response, and flight applicability.

## 4. Retrieval plan / acceptance checklist

- [ ] Fetch PDS calibration collection inventory and identify exact science spectra/labels for all listed TIDs (housekeeping for TIDs 10191 and 10194 is already audited in the branch roadmap).
- [ ] Download each candidate product with PDS labels; record DOI/URN, version, checksum, and source URL.
- [ ] Parse science data and label-defined columns, units, missing-value codes; reject mismatched row counts.
- [ ] Join product families only by documented event/TID IDs; verify marker/log phase structure.
- [ ] Resolve TID 10191 species ambiguity using raw science product labels, spectra and event logs.
- [ ] Establish calibration gas composition/purity and external reference-gauge pressure metadata for each run.
- [ ] Compare replicate runs; separate configuration changes (filament, CEM, emission, scan) rather than pooling.
- [ ] Compute calibration only from raw measurements and traceable standards; report confidence/uncertainty and fit range.
- [ ] Keep readiness gate blocked until each required flight-applicability gate is supported by event-scoped evidence.

## 5. Frozen archive inventory results (retrieved 2026-11-27)

The automated workflow retrieved the official PDS inventory CSV (4,338 bytes) and collection label (4,441 bytes), HTTP 200, and froze SHA-256 metadata. Inventory: **50 primary members, 0 secondary**. All 50 records belong to the targeted 13 TIDs. Product family counts: 13 marker files, 13 message logs, 12 housekeeping files, 12 science spectra.

| TID | inventory product families | status |
|---|---|---|
| 10191 | marker + message only; **no science/HK members in inventory** | incomplete; likely requires alternative source or product clarification |
| 10194 | science + HK + marker + message | complete product family present |
| 10197, 10198, 10199 | science + HK + marker + message | complete family present |
| 10201, 10202 | science + HK + marker + message | complete family present |
| 10205, 10207 | science + HK + marker + message | complete family present |
| 10216, 10217 | science + HK + marker + message | complete family present (switching tests) |
| 10241, 10242 | science + HK + marker + message | complete family present (pre/post pinch-off) |

This **changes retrieval priorities**: TID 10191 cannot be analyzed as a complete event from this collection; do not silently substitute 10194 or use its message log to infer the spectrum. For the other 12 TIDs, exact product identifiers are available and can be retrieved next. The inventory automation succeeded in CI; parser self-test passed.

## 6. Explicit conclusions (current)

- The source documents and calibration-event inventory are verified. The branch roadmap records that pre-flight housekeeping payloads for TIDs 10191 and 10194 have already been retrieved and audited, but the science spectra/raw calibration response products and external pressure-gauge series are not yet established here.
- There is an event-identity conflict for TID 10191: SIS Table A-11 says Argon; its message-log directory is reported as `KrCalibration`, while the raw spectrum favors Ar. Resolve from product labels, spectra and configuration before accepting any species assignment. TID 10194 is consistent with Kr.
- The current pressure blocker is external stable ion-gauge reference plus calibration certificate/range and acquisition-time alignment. Sparse `CDH:BA_PRES` telemetry is voltage, not a pressure calibration; no conversion from that voltage is permitted.
- No sensitivity values, C_EN, closed-source/ram correction, or CPS→neutral density conversion are newly claimed.
- This inventory is documentation/provenance work; it does not authorize Scheduler or Mars photochemistry initialization.

## Inventory automation

A CI workflow now exists to freeze the official PDS calibration collection CSV/XML inventory, checksum source files, and identify records matching the candidate TIDs. The workflow includes a parser self-test and manual dispatch; it is deliberately inventory-only and cannot retrieve/calibrate spectra or change scientific readiness. The first remote run is pending.


## 7. Retrieval automation added (2026-11-27)

A manual GitHub Actions workflow and Python resolver were added to retrieve evidence for the 12 complete inventory events (default TIDs: 10194, 10197, 10198, 10199, 10201, 10202, 10205, 10207, 10216, 10217, 10241, 10242). It resolves exact PDS LIDVIDs via the PDS Search API, preserves resolver JSON, follows only locators from resolved product metadata (or relative file references against the calibration archive), records SHA-256/size/source, and uploads an evidence artifact for 14 days. It does not commit raw data to the repository or fit calibration.

**Status:** code/workflow committed, but remote retrieval has not yet been executed in this session. Resolver/API locator schema is intentionally treated as uncertain; the workflow is fail-closed and exits nonzero if any requested product lacks retrieved payload evidence. Therefore raw calibration science payloads remain **not yet verified/retrieved**, and Stage 4.2 remains OPEN / NOT_READY.
