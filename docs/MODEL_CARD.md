# Model card: Aarogya Drishti demonstration model

**Status:** Synthetic mock only — NOT FOR CLINICAL USE  
**Name:** Aarogya Drishti Demo Model  
**Version:** 1.0.0  
**Source:** Deterministic application code; no trained model weights are included or loaded.  
**Training data:** None. No patient images or other clinical data were used to train this demonstration model.  
**License:** Project demonstration code.  

## Intended use

Demonstrate image-quality gating, provenance display, persistence of advisory outputs, and separation of AI inferences from clinician-entered reviews.

## Out-of-scope use

Diagnosis, screening decisions, cancer confirmation or exclusion, staging, triage, treatment selection, or any clinical decision. Outputs must not be used for patient care.

## Output states

- `image_insufficient`
- `suspicious_finding_for_clinical_review`
- `no_suspicious_finding_by_demo_model`

These are synthetic workflow states and are not validated clinical labels.

## Metrics and limitations

Clinical accuracy, sensitivity, specificity, calibration and external validation: **research only / not measured**. The rule-based demonstration is not a medical device, has no clinical performance evidence, and can produce arbitrary synthetic outputs. Localization is always null; no heatmaps are generated.

## Ethics and safeguards

Every result carries the NOT FOR CLINICAL USE label and model provenance. A failed quality check yields `image_insufficient`. AI outputs are append-only and stored separately from signed clinical conclusions. Patient-facing screens must use only the approved neutral wording and never present a diagnosis.
