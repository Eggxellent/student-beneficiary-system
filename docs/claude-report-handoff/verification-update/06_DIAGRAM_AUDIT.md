# Seven-diagram audit

The requested seven original diagrams were not present in the repository file inventory, so none can be visually or semantically audited without inventing details. No diagrams were edited or redrawn.

| Requested diagram | Filename/location found | Audit result |
|---|---|---|
| Activity diagram | Not found | Unverifiable: no original diagram to inspect. |
| Class diagram | Not found | Unverifiable. |
| Context diagram | Not found | Unverifiable. |
| ERD | Not found | Unverifiable. `backend/src/db/schema.sql` and migrations provide schema source, not the requested ERD image. |
| Sequence diagram | Not found | Unverifiable. |
| System architecture diagram | Not found | Unverifiable. `docs/figure-5-1-certificate-data-flow.mmd` is a certificate-specific flow and is not the overall architecture diagram. |
| Use case diagram | Not found | Unverifiable. |

## Available nearby material

- `docs/figure-5-1-certificate-data-flow.mmd` is the one Mermaid diagram source located by the audit. It represents certificate data flow, not one of the seven in the submitted inventory unless the author intended it as a separate figure.
- `backend/src/db/schema.sql`, `backend/src/db/migrations/`, API routes, and frontend role flows can serve as implementation references when the originals are made available.
- The Word report and its embedded diagrams were not present as `.doc`/`.docx` files in the repository. No claim can be made about embedded copies in that document.

## Action for report author

Supply the seven actual image/source files (or a readable PDF/Word report containing them) before requesting line-by-line corrections. Then compare roles, entities, cardinalities, API/service boundaries, duplicate review, Guardian applications, eligibility, awards, and certificates against the inspected local snapshot. Mark any nonimplemented features as proposed/future work rather than implemented. Do not silently replace the diagrams with newly invented ones.
