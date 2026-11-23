# Importing real Karachi venues (free, from OpenStreetMap)

This pulls **real** venue data (names, areas, phone/address where available) from
OpenStreetMap — free, open-licensed (ODbL, just needs attribution), no API key,
no billing. Nothing is invented; fields OSM lacks (capacity, price, facilities,
photos) stay blank for owners to fill.

## Step 1 — export the data (in your browser)

Open this link, wait for it to run, then click **Export → data → download as raw OSM data** (JSON):

https://overpass-turbo.eu/?Q=%5Bout%3Ajson%5D%5Btimeout%3A120%5D%3B%0A%7B%7BgeocodeArea%3AKarachi%7D%7D-%3E.searchArea%3B%0A(%0A%20%20nwr%5B%22amenity%22%3D%22events_venue%22%5D(area.searchArea)%3B%0A%20%20nwr%5B%22name%22~%22banquet%7Cmarquee%7Cwedding%7Cshaadi%7Cbaradari%7Cballroom%7Cmarriage%7Clawn%22%2Ci%5D(area.searchArea)%3B%0A)%3B%0Aout%20center%20tags%3B&R

(The query: inside the Karachi area, find everything tagged as an events venue, or
whose name contains banquet / marquee / wedding / shaadi / baradari / ballroom /
marriage / lawn.)

## Step 2 — save it into the project

Save the downloaded file as:

    data/karachi-venues.json

## Step 3 — preview, then import

    # preview — writes nothing, just lists what it found
    node --env-file=.env scripts/import-venues.js data/karachi-venues.json --dry

    # import for real
    node --env-file=.env scripts/import-venues.js data/karachi-venues.json

Re-running is safe: rows are matched on their OSM id, so an import updates existing
venues in place and never creates duplicates.

## Notes

- Coverage is whatever OSM has for Karachi — realistically dozens to ~150 venues,
  not 500+. No free dataset has 500 verified records with photos.
- Imported venues have **no owner** (they are public directory listings). They can
  be claimed/assigned to an owner later.
- Attribution: data © OpenStreetMap contributors (ODbL). Keep an attribution note
  on any public page that shows this data.
