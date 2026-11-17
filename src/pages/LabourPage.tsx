/**
 * Axis Labour inside the QA app.
 *
 * The labour sheet is a separate, framework-free page (public/labour) that
 * reads and writes the Labour workbook in SharePoint — the workbook stays the
 * master. It is shown here in a frame, like the design tool, and can be opened
 * full screen.
 */
const LABOUR_URL = `${import.meta.env.BASE_URL}labour/`

export function LabourPage() {
  return (
    <div className="design">
      <div className="design__bar">
        <p className="muted small">
          SA labour allocation, live from the Labour workbook in SharePoint — changes save straight into the Excel file.
        </p>
        <a className="btn btn--ghost" href={LABOUR_URL} target="_blank" rel="noopener">
          Open full screen
        </a>
      </div>
      <iframe className="design__frame" src={LABOUR_URL} title="Axis Labour" />
    </div>
  )
}
