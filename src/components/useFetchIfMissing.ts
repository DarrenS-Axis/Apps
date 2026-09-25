import { useEffect, useState } from 'react'
import { useSettings } from '../data/store'
import { isConfigured, syncNow } from '../sync'

/**
 * A link opened on a device that has not got the record yet — from an email,
 * a QR label, another person's phone — fetches from SharePoint before saying
 * it does not exist. True while that fetch is running.
 *
 * The record is given a moment to load from the device first, so an
 * ordinary visit does not set off a fetch.
 */
export function useFetchIfMissing(missing: boolean): boolean {
  const settings = useSettings()
  const [fetching, setFetching] = useState(false)
  const [tried, setTried] = useState(false)
  const can = isConfigured(settings.sync) && navigator.onLine
  useEffect(() => {
    if (!missing || tried || !can) return
    const t = window.setTimeout(() => {
      setTried(true)
      setFetching(true)
      void syncNow().finally(() => setFetching(false))
    }, 700)
    return () => window.clearTimeout(t)
  }, [missing, tried, can])
  return missing && (fetching || (!tried && can))
}
