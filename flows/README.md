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
| `penetration.allocated`          | A penetration allocated to a worker, with due date and note          |
| `defect.allocated`               | A defect allocated to a worker                                       |
| `plant.allocated`                | A piece of plant allocated to a worker                               |
| `plant.missing`                  | Items marked missing after a yard stocktake                          |
| `itp.reviewed_approved`          | An ITP accepted and closed out by the client / superintendent        |
| `notification.test`              | *Send test* on a person in Settings → People                         |

Every event carries **who to tell**, worked out by the app from Settings →
People: the worker it was allocated to, plus everyone in the state (or
marked *every state*) who ticked that event on their profile. `recipients`
lists them with a reason; `notifyEmails` is the same as one
`a@x.com.au; b@y.com.au` string for an Outlook or Teams "To" box. `link`
opens the record in the app.

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
    "summary": { "type": "string" },
    "recipients": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": { "name": { "type": "string" }, "email": { "type": "string" }, "why": { "type": "string" } }
      }
    },
    "notifyEmails": { "type": "string" },
    "link": { "type": "string" }
  }
}
```

Events raised while a phone has no signal wait on the device and are posted
in order at the next sync, once each.

## Flow 0 — Email the people (event driven) — start here

This is the one that makes allocation and notification emails go out.

1. **Trigger**: When an HTTP request is received (method POST, schema above).
   Copy the generated URL into the app: Settings → Microsoft 365 → *Power
   Automate flow URL*. It works without SharePoint sync.
2. **Condition**: `length(triggerBody()?['notifyEmails'])` is greater than 0.
3. If yes, **Send an email (V2)** (Office 365 Outlook, from a shared mailbox
   such as qa@ if you like):
   - To: `@{triggerBody()?['notifyEmails']}`
   - Subject: `Axis QA — @{triggerBody()?['summary']}`
   - Body: `@{triggerBody()?['summary']}` · `@{triggerBody()?['project']?['name']}`
     · due `@{triggerBody()?['record']?['due']}` · note
     `@{triggerBody()?['record']?['note']}` · by `@{triggerBody()?['actor']}` ·
     <a href="`@{triggerBody()?['link']}`">Open in Axis QA</a>
4. **Response**: status 200.

To send one email each instead of one to all, **Apply to each** over
`triggerBody()?['recipients']` and send to `items('Apply_to_each')?['email']`.
Add Flow 1's Teams post in the same flow if you want both.

Without a flow, the app still lets the person allocating send the email: it
opens their mail app with the message written, addressed to the worker.

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
| QA Penetrations     | ProjectId, Number, Kind, Size, Ref, Material, FRL, ProfileId, Status, AssignedTo, AssignedEmail, AssignDue |
| QA Defects          | ProjectId, Number, Service, Status, Cost, RaisedAt, AssignedTo, AssignedEmail, AssignDue |
| QA Photos           | ProjectId, ItpId, PenetrationId, DefectId, PlantId, TakenAt, FilePath                  |
| QA Plant            | PlantNo, AxisNo, EquipmentType, BrandModel, Serial, Status, Location, ProjectId, SeenAt, SeenBy, LastTestAt, AssignedTo, AssignedEmail, AssignDue |
| QA Depots           | Address, Lat, Lng, Radius                                                              |
| QA People           | Email, Role, Phone, Notify, AllStates, Active                                          |

`AssignDue` on the three work lists makes an overdue-work reminder a simple
scheduled flow: daily, **Get items** where `AssignDue` is before today and the
status is still open, and email `AssignedEmail`.
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
