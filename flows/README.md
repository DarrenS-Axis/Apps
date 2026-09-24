# Power Automate flows for Axis QA

The app raises events to one flow URL, and every record also lands in
SharePoint lists, so there are two ways to automate: react to an event the
app posts, or react to a SharePoint list change. Both are set out below with
the exact triggers and fields.

## What the app posts

Settings → Microsoft 365 → **Power Automate flow URL** takes the URL of a
flow whose trigger is **When an HTTP request is received**. The app POSTs a
JSON body for each of these:

| `event`                          | When                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| `itp.completed_by_site`          | Every applicable step signed and the Axis sign-off given             |
| `itp.reviewed_approved`          | The client / superintendent's additional sign-off given              |
| `itp.defected`                   | An ITP sent back at review                                           |
| `itp.hold_point_reached`         | Work has reached a hold point that needs release                     |
| `penetration.completed_by_site`  | A Firedoc penetration marked complete by site                        |
| `penetration.defected`           | A penetration defected at review, with the defect note               |
| `defect.raised`                  | A Reviewdoc defect raised, with service, description and cost        |
| `defect.closed`                  | A Reviewdoc defect closed                                            |

Body shape (paste this as the trigger's **Request Body JSON Schema** — it is
also shown in the app under *Show the request body JSON schema*):

```json
{
  "type": "object",
  "properties": {
    "event": { "type": "string" },
    "at": { "type": "string" },
    "actor": { "type": "string" },
    "state": { "type": "string" },
    "businessUnit": { "type": "string" },
    "project": {
      "type": "object",
      "properties": {
        "id": { "type": "string" }, "name": { "type": "string" },
        "number": { "type": "string" }, "client": { "type": "string" }
      }
    },
    "record": { "type": "object" },
    "summary": { "type": "string" }
  }
}
```

Events raised while a phone has no signal wait on the device and are posted
in order at the next sync, once each.

## Flow 1 — Notify the state QA channel (event driven)

1. **Trigger**: When an HTTP request is received (method POST, schema above).
   Copy the generated URL into the app.
2. **Condition**: `triggerBody()?['state']` is equal to `NSW` (one branch per
   state, or a Switch on `state`).
3. **Post message in a chat or channel** (Teams): the state's QA channel.
   Message: `@{triggerBody()?['summary']}` — `@{triggerBody()?['project']?['name']}`
   — by `@{triggerBody()?['actor']}`.
4. Optional **Condition** on `event` = `itp.hold_point_reached` → **Send an
   email (V2)** to the superintendent named on the project.
5. **Response**: status 200 (the app treats anything else as failed and
   retries later).

`flows/notify-state-qa.json` is the definition of this flow for reference.

## Flow 2 — Hold point released reminder (SharePoint driven)

1. **Trigger**: When an item is created or modified — site: your QA site,
   list: **QA ITPs**.
2. **Condition**: `OpenHolds` greater than 0 and `Status` is equal to
   `In progress`.
3. **Delay** 1 day, then **Get item** again and re-check `OpenHolds`; if still
   open, **Send an email** to the state QA lead: ITP `ItcNumber` on
   `Title` (`Area`) has a hold point waiting.

## Flow 3 — Monthly QA report (scheduled)

The app's *QA report* screen computes the monthly report live. To distribute
it automatically:

1. **Trigger**: Recurrence — first of the month, 7 am.
2. **Get items** from **QA ITPs**, **QA Penetrations** and **QA Defects**
   (filter query `State eq 'NSW'` for a state report; no filter for national).
3. **Select** the columns the report prints:
   - Penetrations: `ProjectId`, `Status` → count per project per status
   - ITPs: `ProjectId`, `DateClosed`, `Status`
   - Defects: `ProjectId`, `Service`, `Cost`, `Status`
4. **Create CSV table** for each, **Create file** in the **QA Files** library
   under `reports/YYYY-MM/`, and **Send an email** with the files attached.

For a formatted report, point Power BI at the three lists instead — every
column the report needs is a plain list column, not inside the JSON payload.

## The lists

Provisioning from the app creates these on the site, each with `RecordId`,
`State`, `UpdatedAt` and `Payload` plus its own columns:

| List                | Plain columns for flows and Power BI                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| QA Business Units   | Entity                                                                                 |
| QA Projects         | BusinessUnitId, ProjectNumber, Client, Archived                                        |
| QA Drawings         | ProjectId, Number, Revision, FilePath                                                  |
| QA ITPs             | ProjectId, ItcNumber, ItpNumber, TemplateCode, Area, Status, Progress, OpenHolds, DateClosed |
| QA Penetrations     | ProjectId, Number, Kind, Size, Ref, Material, FRL, ProfileId, Status                   |
| QA Defects          | ProjectId, Number, Service, Status, Cost, RaisedAt                                     |
| QA Photos           | ProjectId, ItpId, PenetrationId, DefectId, TakenAt, FilePath                           |
| QA Files (library)  | `plans/`, `photos/`, `attachments/` — the images the lists point to via FilePath       |

`Payload` holds the full record as JSON and is what the app reads back; the
plain columns are derived from it on every write and are for reporting only.
Editing a plain column in SharePoint does not change the record — edit in
the app.

## Entra ID app registration (one-off, by a Microsoft 365 admin)

1. Entra admin centre → App registrations → New registration.
   Name *Axis QA*, single tenant, platform **Single-page application**,
   redirect URI = the URL the app is served from (e.g.
   `https://darrens-axis.github.io/Apps/`). Add each URL the app is opened
   from, including any custom domain.
2. API permissions → Microsoft Graph → **Delegated**: `User.Read`,
   `Sites.ReadWrite.All`, `Files.ReadWrite.All`. Grant admin consent.
3. Copy the **Directory (tenant) ID** and **Application (client) ID** into
   Settings → Microsoft 365 in the app. No client secret is used or needed.
4. In the app: Sign in with Microsoft → Provision SharePoint lists → Sync now.
