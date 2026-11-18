# RepairLoop

MERN application for the first two RepairLoop features assigned to Farah Ulfat Oni:

1. Device Assessment and Repair Quotation Approval
2. Repair Execution and Quality Verification

## Run locally

1. Run `npm run db:up` to start the included MongoDB Docker service.
2. The included `.env` is already configured for the local database. Update `MONGODB_URI` only if you use a hosted database.
3. Run `npm run seed` once to load two useful sample repair cases.
4. Run `npm run dev`.
4. Open the Vite address shown in the terminal (normally `http://localhost:5173`).

Set `GEMINI_API_KEY` in `.env` to enable live Gemini visual observations from an uploaded device image. Without it, the interface gives a clear physical-inspection fallback.

## Included flows

- Create a repair case with customer, device, fault and arrival information.
- Record physical receipt, diagnosis, recommended work and costs.
- Generate versioned, itemised quotations and record customer acceptance through the API/UI.
- Assign a technician, record progress and run a required quality checklist.
- Mark a device ready for return only when every quality check has passed.
