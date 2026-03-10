# Proposal – Unified Data Ingestion API & Dashboard

**Prepared for:** The Weston Group – www.weston.com  
**Prepared by:** Gritsa LTD – www.gritsa.com

---

## Service Overview
Gritsa LTD will deliver a **single‑point data ingestion platform** that consolidates all of The Weston Group’s disparate data streams into a unified storage model and presents the information through an intuitive, filter‑rich dashboard.

### Key Benefits
- **Simplified Integration** – One API endpoint for all sources (webhooks, SaaS, on‑prem systems).
- **Automatic Normalisation** – Incoming payloads are identified, validated and transformed to a common data model without manual mapping.
- **Actionable Insights** – A responsive dashboard provides aggregated views, drill‑down filters and export capabilities, enabling rapid decision‑making.

---

## Technical Approach
1. **Unified Ingestion API**
   - Expose a single HTTPS endpoint (`https://api.weston.com/ingest`).
   - Accept JSON, CSV, raw logs, etc., via POST (webhook‑style) from any system.
   - Authenticate requests using API keys or OAuth2.
2. **Smart Data Detection & Normalisation**
   - Inspect payload schema to infer data type.
   - Apply transformation rules to map fields onto the unified data model.
   - Store the cleaned records in a central PostgreSQL (or equivalent) data store.
3. **Dashboard Layer**
   - Implemented with a free‑for‑commercial‑use solution such as **Looker Studio** or **Metabase**.
   - Pre‑defined filters (date, source, category) and custom aggregation widgets.
   - Role‑based access control for secure multi‑user access.

---

## Pricing
| Scope | Effort (hrs) | Fixed Cost |
|-------|--------------|------------|
| End‑to‑end solution (API + normalisation + dashboard) | 40‑60 | **$4,000** |

### Optional Time‑and‑Materials Support
- **Integration Assistance** – If The Weston Group prefers to handle webhook implementation themselves, we can provide hourly support for any remaining “last‑mile” work.
- **Rate:** $120 / hour (or as mutually agreed).

---

## Contact
**Name:** Abi Chatterjee  
**Email:** abi@gritsa.com  
**Phone:** +447436855207

---

## Next Steps
1. **Kick‑off meeting** – Align on data sources, security requirements and UI preferences.
2. **Prototype delivery** – 2‑week sprint to expose the ingestion endpoint and a basic dashboard.
3. **Iterative refinement** – Incorporate feedback, add source‑specific adapters, and finalise the UI.

We look forward to partnering with The Weston Group to turn fragmented data into a single, actionable asset.

---

*Prepared on $(date)*