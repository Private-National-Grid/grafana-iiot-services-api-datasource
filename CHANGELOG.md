# 2.0.0

PNG fork of the COPA-DATA plugin. **Breaking:** new plugin id.

### Breaking changes
* Plugin id renamed `copadata-iiot-services-datasource` → `png-iiot-services-datasource`. Provisioned
  datasources need `type: png-iiot-services-datasource`, dashboards that reference the datasource by
  `type` need the same change, and `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS` must list the new id.
  The query model is unchanged, so saved panel queries keep working.
* Requires Grafana 13.1 or later.

### Build / tooling
* Migrated from the deprecated `@grafana/toolkit` (Grafana 8.3) to `@grafana/create-plugin`
  (webpack + SWC, Jest, ESLint 9, Playwright e2e), `@grafana/*` 13.x and React 19.
* `dist/` is no longer committed. GitHub Actions builds, type-checks, lints and tests every push/PR,
  and a `v*` tag publishes a GitHub Release with the plugin zip and its SHA-256 checksum.

### Changes
* Requests use `getBackendSrv().fetch` instead of the deprecated `datasourceRequest`, and frames
  are built with `createDataFrame` instead of the deprecated `MutableDataFrame`.
* Editors rebuilt on `InlineField`/`InlineFieldRow` instead of the legacy `gf-form` CSS classes and
  `LegacyForms` controls.
* Variable selectors filter by the typed text instead of listing every variable: the *Variable Filter* list
  is requested from the IIoT Services API with a name filter (`*<text>*`, `*` as wildcard), the archive
  *Variable* list is narrowed to matching names. Requests wait for a 300 ms typing pause. Selected
  variables stay selected when the option list is filtered.

### Fixes
* Template variables are resolved on a copy of each query; previously the panel's stored targets were
  mutated in place.
* Alarm/event values of `0`/`false` are kept instead of being shown as empty.
* Saved queries missing newer fields get defaults before they run, instead of failing.
* "Service Engine" origin label typo.


# 1.3.0

### Features / Enhancements
* Updated naming of *Service Grid* to *IIoT Services*
* Updated Grafana libraries to version 8.3.0


# 1.2.0

### Features / Enhancements
* Added possibility to directly request data from the Service Grid Data Storage via Service Grid API
* Service Grid version must be minimum version 10.2.2109.17002
* Added possibility to apply regex filter for template variables


# 1.1.1

### Features / Enhancements
* Added checkbox to also include temporary offline Datasources in query editor

### Bug Fixes
* Fixed case sensitive typo in archive data request payload


# 1.1.0

### Features / Enhancements
* Moved to Grafanas new React framework for plugins
* Added support for template variables
* Added a Online Values query type
* Variable selection now supports multiple values
* Removed the alias field, because renaming can now be handled through Grafanas overrides

### Bug Fixes
* Only datasource with status `online` will be shown


# 1.0.1

### Features / Enhancements
* Added possibility to set an alias for a variable query

### Bug Fixes
* Available data sources, archives and variables are now sorted by name in dropdown elements
* Aggregated archives are also shown in the list of available archives


# 1.0.0

### Features / Enhancements
* Initial Release of data source implementation

### Bug Fixes