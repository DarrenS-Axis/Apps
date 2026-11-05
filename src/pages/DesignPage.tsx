/**
 * Axis MEP Design inside the QA app.
 *
 * The design tool is a separate, framework-free app (public/mep) with its own
 * tests. It is shown here in a frame so it sits under the Axis header and tab
 * bar, while staying independently deployable and openable full screen.
 * Same origin, so its autosave and plan storage are this browser's.
 */
const MEP_URL = `${import.meta.env.BASE_URL}mep/index.html`

export function DesignPage() {
  return (
    <div className="design">
      <div className="design__bar">
        <p className="muted small">
          Pipe, duct &amp; gas sizing — cold &amp; heated water, drainage, gas and supply air. Results are indicative: check
          them against AS/NZS 3500 and AS/NZS 5601.1 before issuing. <span className="design__narrow">Best on a tablet or computer.</span>
        </p>
        <a className="btn btn--ghost" href={MEP_URL} target="_blank" rel="noopener">
          Open full screen
        </a>
      </div>
      <iframe className="design__frame" src={MEP_URL} title="Axis MEP Design" />
    </div>
  )
}
