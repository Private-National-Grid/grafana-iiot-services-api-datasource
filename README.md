# zenon IIoT Services Datasource for Grafana (PNG fork)

Grafana datasource for COPA-DATA's zenon IIoT Services API: historic (archive) values, online values,
alarms and events.

This is **PNG's maintained fork** of
[COPA-DATA/grafana-iiot-services-api-datasource](https://github.com/COPA-DATA/grafana-iiot-services-api-datasource),
which is no longer maintained. Differences from upstream:

| | Upstream (1.3.0) | This fork (2.x) |
| --- | --- | --- |
| Plugin id | `copadata-iiot-services-datasource` | `png-zenon-datasource` |
| Tooling | `@grafana/toolkit` (Grafana 8.3) | `@grafana/create-plugin` (Grafana 13) |
| Grafana | `>= 8.3` | `>= 13.1` |
| Distribution | `dist/` committed to git | versioned GitHub Releases (zip + SHA-256), built by CI |

The query model is unchanged, so dashboards built with the upstream plugin keep working once their
datasource `type` is changed to `png-zenon-datasource` (see [CHANGELOG](CHANGELOG.md)).

> **Note:** the upstream code was provided by COPA-DATA "as is", not covered by COPA-DATA's support and
> product lifecycle, under the MIT license. This fork is not affiliated with or supported by COPA-DATA.

For the zenon software platform documentation see https://onlinehelp.copadata.com/


## Prerequisites
The following prerequisites need to be met in order to use this datasource:
- working IIoT Services (Service Grid) installation with IIoT Services (Service Grid) API >= 12.0.2307.4002  
**Hint:** For versions prior 12.0, you can use this latest version of the datasource demo code, but please refer to the configuration instructions for version 1.2.0 of the datasource plugin (https://github.com/COPA-DATA/grafana-iiot-services-api-datasource/tree/v1.2.0)
- Grafana >= 13.1



## Supported data queries
The following data can be retrieved from IIoT Services API via this datasource:
- Historic variable values
- Online values
- Alarm entries
- Event entries

To show alarm and event entries, the usage of Grafana's table panel is recommended.


## Installation
1. Download `png-zenon-datasource-<version>.zip` from the
   [Releases](https://github.com/Private-National-Grid/grafana-iiot-services-api-datasource/releases) page and
   check it against the `.sha256` file published next to it.
2. Unzip it into Grafana's plugin folder (e.g. `/var/lib/grafana/plugins/`), giving
   `.../plugins/png-zenon-datasource/`.
3. The plugin is unsigned, so allow it explicitly:
   `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=png-zenon-datasource`
   (or `allow_loading_unsigned_plugins` in `grafana.ini`).


## Configuration

Prior to using the IIoT Services Datasource, the following things need to be configured:
- OAuth2 client definition for Grafana using IIoT Services Identity Management
- OAuth2 configuration for Grafana
- Datasource configuration

### Configure Grafana OAuth2 client using Identity Management

In order that Grafana can use the IIoT Services Identity Service for user authentication, a client definition needs to be setup using the Identity Management.
For this client configuration, it is important to set the correct client id, redirect uri and scopes for Grafana. The client secret, which is required for `custom.ini` is generated during this configuration step.

See the following table for reference:

| Field | Value | Note (or reference to `custom.ini`) |
| - | - | - |
| Client ID | grafana | arbitrary client id, must be the same as `client_id` |
| Client name | Grafana | arbitrary name |
| Redirect URLs | https://\<grafana-uri\>:\<grafana-port\>/login/generic_oauth | see https://grafana.com/docs/auth/generic-oauth/ for reference |
| Allowed scopes | openid profile iiotServicesAPI dataStorageAPI offline_access email | the same as in `scopes` |
| Grant types | Code | required by Grafana |
| Allow access tokens via browser | checked | required to pass OAuth tokens via browser requests |
| Secret | generated value | must be copied to `client_secret` |


For additional information on the Identity Management, please refer to the IIoT Services manual (https://onlinehelp.copadata.com/).

### Configure Grafana for OAuth2 Authentication

Grafana supports the OAuth2 authentication mechanism for authenticating users against OAuth2 Identity providers. Grafana plugins allow to forward those OAuth2 tokens to the respective API endpoints, where they would query the data from. In terms of IIoT Services, Grafana must be able to authenticate a user against the IIoT Services Identity Service and has to forward this OAuth2 token via the Datasource Plugin to the IIoT Services API, to read data from it.
In fact this means that the Grafana Backend needs to be configured to use OAuth2 (https://grafana.com/docs/auth/generic-oauth/).

See the following configuration section from the configuration file *custom.ini*:

If there is no configuration file in folder *C:\Program Files\GrafanaLabs\grafana\conf* called *custom.ini*, simply create a new empty text file and name it that way.

```INI
[server]
protocol=https
cert_file=<path>\certificate.crt
cert_key=<path>\private.key
domain=<grafana domain>
root_url=%(protocol)s://%(domain)s:3000/

[auth.generic_oauth]
enabled=true
client_id=grafana
client_secret=<client secret>
scopes=iiotServicesAPI openid profile email offline_access dataStorageAPI
auth_url=https://<domain-of-iiot-services>:<port-of-iiot-services/identity-service/connect/authorize
token_url=https://<domain-of-iiot-services>:<port-of-iiot-services>/identity-service/connect/token
api_url=https://<domain-of-iiot-services>:<port-of-iiot-services>/identity-service/connect/userinfo
allowed_domains=<list of allowed email domains>
allow_sign_up=true
send_client_credentials_via_post=true

[plugins]
allow_loading_unsigned_plugins=png-zenon-datasource
```

**Hint:** When Grafana is being operated using Docker, please refer to the Grafana documentation (https://grafana.com/docs/grafana/latest/installation/configure-docker/) how to provide configuration options via environment variables.

After the successful configuration, Grafana needs to be restartet, so that the changes take effect.
Depending on your installation approach, different actions might be required:
* restart the Grafana service using task manager
* restart the executable manually when Grafana has been started using Powershell or Command Prompt
* restart the Grafana Docker container

### Configuration Datasource

Once the Datasource plugin is installed, as outlined in section **Installation**, the datasource can be created using the Grafana UI.
In order that the Datasource can authenticate requests at the IIoT Services API, it is required that OAuth authentication tokens are forwarded.
This is done by checking the option "Forward OAuth Identity" in the Datasource configuration.
For the URL use the respective url of the IIoT API in the form `https://<domain-of-iiot-services>:<port-of-iiot-services>/iiot-api`.

## Using the Datasource to query data

To create data queries, this datasource provides a query editor with the following options:

| Option | Description | Note |
| - | - | - |
| Datasource | Selection of the available zenon Datasources for the current user |
| Query Type | Selection of the desired data request (`Archive Data` \| `Online Values` \| `Alarms` \| `Events`) |
| Archive | Selection of available archive for the selected zenon Datasource | only available for Query Type `Archive Data` |
| Variable | Selection of available variables for the selected zenon Datasource and archive. Typing narrows the list to variables whose name contains the text (case-insensitive, `*` as wildcard) | only available for Query Type `Archive Data` |
| Variable Filter | Allows filtering the resulting data for a specific variable. The filter allows to use an `*` as wildcard. Typing narrows the variable list on the server: `INV` requests `*INV*`, `INV*PAC` requests `*INV*PAC*` | only available for Query Types `Alarms`, `Events` and `Online Values`|
| Only Active | Only active alarms are shown | only available for Query Types `Alarms` |
| Only Cleared | Only cleared alarms are shown | only available for Query Types `Alarms` |
| Only Active | Only unacknowledged alarms are shown | only available for Query Types `Alarms` |
 

The following images show the query editor for the different Query Types.

- Query Type `Archive Data`:

  ![](./doc/datasource-query-archive-data.png)

- Query Type `Alarms`:

  ![](./doc/datasource-query-alarms.png)

- Query Type `Events` and `Online Values`:

  ![](./doc/datasource-query-events.png)

## Using Template Variables

The datasource supports 4 different kinds of template variables:
| Option | Description |
| - | - |
| Datasources | List all available datasources |
| Archives for datasource | List all archives for a given datasource |
| Variables for archive | List all variables of a given archive |
| Variables for datasource | List all variables of a given datasource |

### Filtering
With the field "Filter values" you can apply a regex filter to reduce the set of available values to select from in the Grafana dashboard.

# Development

Scaffolded with [`@grafana/create-plugin`](https://grafana.com/developers/plugin-tools/). Files under
`.config/` are managed by create-plugin; update them with `npx @grafana/create-plugin@latest update`
rather than editing them.

Requires Node.js 22+ (see `.nvmrc`) and Docker for the local Grafana.

```bash
npm ci               # install (lifecycle scripts are disabled by .npmrc)
npm run dev          # build in watch mode into dist/
npm run server       # Grafana with the plugin mounted, at http://localhost:3000
npm run typecheck && npm run lint && npm run test:ci
npm run build        # production build into dist/
npm run e2e          # Playwright smoke tests against `npm run server`
```

## Releasing

1. Bump `version` in `package.json` (and `package-lock.json`) and add a `CHANGELOG.md` entry.
2. Merge to `master`, then tag: `git tag v2.0.1 && git push origin v2.0.1`.
3. The *Release* workflow builds, tests, and publishes
   `png-zenon-datasource-<version>.zip` plus `.zip.sha256` as a GitHub Release.

The tag must match `package.json`'s version or the release job fails.


# Troubleshooting

## Why are there no Datasources listed in the dropdown?
Make sure that the user, which is trying to request data from the IIoT Services API, has sufficient permissions and is assigned to the desired datasources in the Identity Management.
Try to perform requests using the IIoT Services API's Swagger UI client, to eliminate any configuration mistakes for the IIoT Services Datasource plugin.

## Why am I not able to connect to grafana even if it is started?
Make sure that the used port (default: *3000*) is available and not used by any other services.

## The Datasource does show errors when requesting data and the last log in was approx. 1 hour ago.
Check in the Identity Management if the Grafana client definition includes the scope `offline_access` and it is allowed to use refresh tokens. Also Grafana's configuration file must include the scope `offline_access`.

## Timestamps of Alarms and Events are displayed as numbers (e.g. *'1.57 Tri'*)
Timestamps of alarm and event entries are encoded as UNIX timestamps. Using the table panel requires to specify column styles, which format those timestamps in the desired date format.
The format `/.\*Time\*/` allows all relevant columns to be formated as date time.

![](./doc/timestamp-format.png)
