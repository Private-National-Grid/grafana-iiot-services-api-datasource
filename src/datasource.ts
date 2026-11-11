import {
  createDataFrame,
  DataFrame,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  FieldType,
  MetricFindValue,
  QueryResultMetaNotice,
  ScopedVars,
  TestDataSourceResponse,
} from '@grafana/data';
import { getBackendSrv, getTemplateSrv, isFetchError } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import {
  DataOrigin,
  DataSourceQuery,
  DataSourceQueryType,
  DEFAULT_SERVICE_ENGINE_FILL_LOOKBACK_HOURS,
  defaultQuery,
  Option,
  SGApiDataSourceOptions,
  TemplateVariableQuery,
  TemplateVariableQueryType,
  withDefaults,
} from './types';

/**
 * Turns what the user typed into a zenon variable-name filter.
 * Matches anywhere in the name; `*` inside the text is a wildcard:
 * "" -> "*", "INV" -> "*INV*", "INV*PAC" -> "*INV*PAC*".
 */
export function toNamePattern(input?: string): string {
  const typed = (input ?? '').trim();
  return typed === '' ? '*' : ('*' + typed + '*').replace(/\*+/g, '*');
}

/** Case-insensitive test of a name against a pattern from toNamePattern(). */
export function matchesNamePattern(name: string, pattern: string): boolean {
  const body = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + '$', 'i').test(name);
}

/** Converts an API value to a number the way Grafana's old MutableDataFrame parser did. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const text = String(value).trim();
  if (text === '') {
    return null;
  }
  const n = Number(text);
  return isNaN(n) ? null : n;
}

/** Converts an API timestamp (ISO string or epoch ms) to epoch ms, or null. */
export function toTime(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value !== '') {
    const ms = Date.parse(value);
    return isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Expands template variables in a list of variable names. A multi-value variable used
 * with the `:json` format expands to a JSON array, which becomes several names.
 */
export function expandTemplateVariables(names: string[], scopedVars?: ScopedVars): string[] {
  const templateSrv = getTemplateSrv();
  const result: string[] = [];
  for (const name of names ?? []) {
    const value = templateSrv.replace(name, scopedVars);
    if (value.startsWith('["')) {
      result.push(...(JSON.parse(value) as string[]));
    } else {
      result.push(value.replace(/['"]+/g, ''));
    }
  }
  return result;
}

const byLabel = (a: Option, b: Option) => (a.label > b.label ? 1 : -1);

const INVALID_FORMAT = 'Query Error: Retrieved data has invalid format';

/** One archive variable's samples, as parallel arrays. */
interface ArchiveSeries {
  name: string;
  values: Array<number | null>;
  times: Array<number | null>;
}

/** Builds a readable message from a failed request (port of the original handleHttpErrors). */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (isFetchError(err)) {
    const data = err.data as { errorMessage?: string; variableErrors?: unknown } | undefined;
    if (err.status === 400) {
      if (data?.errorMessage !== undefined && data?.variableErrors !== undefined) {
        return 'Bad Request: ' + data.errorMessage + '; Details: ' + JSON.stringify(data.variableErrors);
      }
      return data?.errorMessage ?? 'Bad Request';
    }
    if (data?.errorMessage !== undefined) {
      return data.errorMessage;
    }
    if (err.status === 401) {
      return 'Authorization Error: 401 Unauthorized';
    }
    return `${err.status} ${err.statusText ?? ''}`.trim();
  }
  return String(err);
}

export class DataSource extends DataSourceApi<DataSourceQuery, SGApiDataSourceOptions> {
  url: string;
  showOfflineDatasources: boolean;
  serviceEngineFillLookbackHours: number;

  constructor(instanceSettings: DataSourceInstanceSettings<SGApiDataSourceOptions>) {
    super(instanceSettings);
    this.url = instanceSettings.url!;
    this.showOfflineDatasources = instanceSettings.jsonData.showOfflineDatasources ?? false;
    const lookback = Number(instanceSettings.jsonData.serviceEngineFillLookbackHours);
    this.serviceEngineFillLookbackHours =
      Number.isFinite(lookback) && lookback > 0 ? lookback : DEFAULT_SERVICE_ENGINE_FILL_LOOKBACK_HOURS;
  }

  getDefaultQuery(): Partial<DataSourceQuery> {
    return defaultQuery;
  }

  // ---------------------------------------------------------------- HTTP

  /** Raw request through the Grafana proxy; rejects with the FetchError. */
  private async rawRequest<T>(path: string, method: 'GET' | 'POST', data?: unknown): Promise<T> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<T>({ url: this.url + path, method, data, showErrorAlert: false })
    );
    return response.data;
  }

  /** Request whose failure carries the "Query Error" message shown in panels. */
  private async request<T>(path: string, method: 'GET' | 'POST', data?: unknown): Promise<T> {
    try {
      return await this.rawRequest<T>(path, method, data);
    } catch (err) {
      throw new Error('Query Error: Error during requesting data from API. ' + toErrorMessage(err));
    }
  }

  // ---------------------------------------------------------------- Panel queries

  async query(options: DataQueryRequest<DataSourceQuery>): Promise<DataQueryResponse> {
    const from = options.range.from.toISOString();
    const to = options.range.to.toISOString();

    const queries = options.targets
      .filter((target) => target.hide !== true)
      .map((target) => this.applyTemplateVariables(withDefaults(target, defaultQuery), options.scopedVars));

    const running: Array<Promise<DataFrame[]>> = [];
    for (const query of queries) {
      if (
        !query.datasourceId ||
        (query.queryType === DataSourceQueryType.ArchiveData &&
          (!query.archiveFilter.archiveId || query.archiveFilter.variables.length === 0))
      ) {
        continue;
      }
      switch (query.queryType) {
        case DataSourceQueryType.ArchiveData:
          running.push(this.queryArchiveValues(query, from, to));
          break;
        case DataSourceQueryType.Alarms:
        case DataSourceQueryType.Events:
          running.push(this.queryAlarmsEvents(query, from, to));
          break;
        case DataSourceQueryType.VariableValues:
          running.push(this.queryOnlineValues(query));
          break;
      }
    }

    const frames = await Promise.all(running);
    return { data: frames.flat() };
  }

  /** Returns a copy of the query with template variables resolved (the stored query is not touched). */
  applyTemplateVariables(query: DataSourceQuery, scopedVars: ScopedVars): DataSourceQuery {
    const templateSrv = getTemplateSrv();
    return {
      ...query,
      datasourceId: templateSrv.replace(query.datasourceId, scopedVars),
      archiveFilter: {
        ...query.archiveFilter,
        archiveId: templateSrv.replace(query.archiveFilter.archiveId, scopedVars),
        variables: expandTemplateVariables(query.archiveFilter.variables, scopedVars),
      },
      alarmsEventsFilter: {
        ...query.alarmsEventsFilter,
        variables: expandTemplateVariables(query.alarmsEventsFilter.variables, scopedVars),
      },
      variableFilter: {
        ...query.variableFilter,
        variables: expandTemplateVariables(query.variableFilter.variables, scopedVars),
      },
    };
  }

  /** Archive samples per variable, in the order the API returned them. */
  private async fetchArchiveSeries(
    query: DataSourceQuery,
    origin: DataOrigin.DataStorage | DataOrigin.ServiceEngine,
    from: string,
    to: string
  ): Promise<ArchiveSeries[]> {
    const path = `/api/v2/datasources/${query.datasourceId}/archives/${query.archiveFilter.archiveId}/query`;
    const body = {
      variableFilter: { variableNames: query.archiveFilter.variables },
      timeFilter: { from, to, type: 'Absolute' },
      origin,
    };
    const data = await this.request<any>(path, 'POST', body);
    if (!data || !Array.isArray(data.variables)) {
      throw new Error(INVALID_FORMAT);
    }

    return data.variables.map((entry: any): ArchiveSeries => {
      const name = entry?.archiveVariable?.variableName;
      if (name === undefined) {
        throw new Error(INVALID_FORMAT);
      }
      const values: any[] = entry.values ?? [];
      return {
        name,
        values: values.map((v) => toNumber(v.value)),
        times: values.map((v) => toTime(v.timestamp)),
      };
    });
  }

  private toArchiveFrames(query: DataSourceQuery, series: ArchiveSeries[], notices: QueryResultMetaNotice[] = []) {
    return series.map((s) =>
      createDataFrame({
        refId: query.refId,
        fields: [
          { name: s.name, type: FieldType.number, values: s.values },
          { name: 'time', type: FieldType.time, values: s.times },
        ],
        ...(notices.length > 0 ? { meta: { notices } } : {}),
      })
    );
  }

  async queryArchiveValues(query: DataSourceQuery, from: string, to: string): Promise<DataFrame[]> {
    if (query.archiveFilter.origin === DataOrigin.DataStorageWithServiceEngineFill) {
      return this.queryArchiveWithServiceEngineFill(query, from, to);
    }
    const origin =
      query.archiveFilter.origin === DataOrigin.ServiceEngine ? DataOrigin.ServiceEngine : DataOrigin.DataStorage;
    return this.toArchiveFrames(query, await this.fetchArchiveSeries(query, origin, from, to));
  }

  /**
   * Data Storage first, then the tail it does not have yet from the Service Engine.
   *
   * The Service Engine archive is a store-and-forward buffer that drains into Data Storage, so
   * what Data Storage lacks is the newest data. The cut-off is the newest Data Storage sample
   * across all queried variables (how far forwarding has got); only samples after it are read
   * from the Service Engine, and never more than `serviceEngineFillLookbackHours` back from the
   * range end, to protect the plant Service Engine and the WAN. A Service Engine failure does not
   * fail the panel: the Data Storage data is returned with a warning.
   */
  async queryArchiveWithServiceEngineFill(query: DataSourceQuery, from: string, to: string): Promise<DataFrame[]> {
    const stored = await this.fetchArchiveSeries(query, DataOrigin.DataStorage, from, to);

    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    let newest: number | null = null;
    for (const s of stored) {
      for (const t of s.times) {
        if (t !== null && (newest === null || t > newest)) {
          newest = t;
        }
      }
    }

    const lookbackStart = toMs - this.serviceEngineFillLookbackHours * 3_600_000;
    const wanted = newest ?? fromMs; // where the missing tail starts
    const cutoff = Math.max(wanted, fromMs, lookbackStart);
    // Samples exactly at the cut-off are already in Data Storage when the cut-off is its newest sample.
    const exclusive = newest !== null && cutoff === newest;

    if (cutoff >= toMs) {
      return this.toArchiveFrames(query, stored);
    }

    const notices: QueryResultMetaNotice[] = [];
    if (lookbackStart > wanted && lookbackStart > fromMs) {
      notices.push({
        severity: 'warning',
        text:
          `Data Storage has no data after ${newest === null ? 'the range start' : new Date(newest).toISOString()}; ` +
          `the Service Engine fill only covers the last ${this.serviceEngineFillLookbackHours} h.`,
      });
    }

    let engine: ArchiveSeries[];
    try {
      engine = await this.fetchArchiveSeries(query, DataOrigin.ServiceEngine, new Date(cutoff).toISOString(), to);
    } catch (err) {
      notices.push({
        severity: 'warning',
        text: 'Service Engine fill unavailable, showing Data Storage only. ' + toErrorMessage(err),
      });
      return this.toArchiveFrames(query, stored, notices);
    }

    const byName = new Map<string, ArchiveSeries>(
      stored.map((s) => [s.name, { ...s, values: [...s.values], times: [...s.times] }])
    );
    let filled = 0;
    for (const s of engine) {
      const into: ArchiveSeries = byName.get(s.name) ?? { name: s.name, values: [], times: [] };
      byName.set(s.name, into);
      s.times.forEach((t, i) => {
        if (t !== null && (exclusive ? t > cutoff : t >= cutoff)) {
          into.times.push(t);
          into.values.push(s.values[i]);
          filled++;
        }
      });
    }

    if (filled > 0) {
      notices.push({
        severity: 'info',
        text: `Values after ${new Date(cutoff).toISOString()} come from the Service Engine (not yet in Data Storage).`,
      });
    }
    return this.toArchiveFrames(query, [...byName.values()], notices);
  }

  async queryOnlineValues(query: DataSourceQuery): Promise<DataFrame[]> {
    const path = `/api/v1/datasources/${query.datasourceId}/variables/query`;
    const body = {
      nameFilter: { variableNames: query.variableFilter.variables },
      fields: ['name', 'value', 'lastUpdateTime'],
    };
    const data = await this.request<any>(path, 'POST', body);
    if (!data || !Array.isArray(data.variables)) {
      throw new Error(INVALID_FORMAT);
    }

    return data.variables.map((entry: any) =>
      createDataFrame({
        refId: query.refId,
        fields: [
          { name: entry.name, type: FieldType.number, values: [toNumber(entry.value)] },
          { name: 'time', type: FieldType.time, values: [toTime(entry.lastUpdateTime)] },
        ],
      })
    );
  }

  async queryAlarmsEvents(query: DataSourceQuery, from: string, to: string): Promise<DataFrame[]> {
    const isAlarms = query.queryType === DataSourceQueryType.Alarms;
    const path = `/api/v1/datasources/${query.datasourceId}/${isAlarms ? 'alarms' : 'events'}/query`;

    const body: Record<string, unknown> = {
      timeFilter: { from, to, type: 'Absolute' },
      variableFilter: { variableNames: query.alarmsEventsFilter.variables },
    };
    if (isAlarms) {
      const flags: string[] = [];
      if (query.alarmsEventsFilter.onlyActive) {
        flags.push('OnlyActive');
      }
      if (query.alarmsEventsFilter.onlyCleared) {
        flags.push('OnlyCleared');
      }
      if (query.alarmsEventsFilter.onlyUnacknowledged) {
        flags.push('OnlyUnacknowledged');
      }
      if (flags.length > 0) {
        body.filterFlags = flags;
      }
    }

    const data = await this.request<any>(path, 'POST', body);
    const items: any[] | undefined = isAlarms ? data?.alarms : data?.events;
    if (!Array.isArray(items)) {
      throw new Error(INVALID_FORMAT);
    }

    const column = (name: string, displayName: string, type: FieldType, pick: (item: any) => unknown) => ({
      name,
      type,
      config: { displayName },
      values: items.map((item) => pick(item) ?? null),
    });
    const user = (item: any) => item.username || item.userFullName || null;

    const fields = [
      column('id', 'Id', FieldType.string, (i) => i.id),
      column('variableName', 'Variable Name', FieldType.string, (i) => i.variableName),
      column('value', 'Value', FieldType.other, (i) => i.value),
      column('text', 'Text', FieldType.string, (i) => i.text),
      column('comment', 'Comment', FieldType.string, (i) => i.comment),
      column('receivedTime', 'Time Received', FieldType.time, (i) => toTime(i.receivedTime)),
      ...(isAlarms
        ? [
            column('clearedTime', 'Time Cleared', FieldType.time, (i) => toTime(i.clearedTime)),
            column('acknowledgedTime', 'Time Acknowledged', FieldType.time, (i) => toTime(i.acknowledgedTime)),
            column('computer', 'Computer', FieldType.string, (i) => i.computer),
            column('acknowledgedBy', 'Acknowledged by', FieldType.string, user),
          ]
        : [
            column('computer', 'Computer', FieldType.string, (i) => i.computer),
            column('user', 'User', FieldType.string, user),
          ]),
    ];

    return [createDataFrame({ refId: query.refId, fields })];
  }

  // ---------------------------------------------------------------- Lookups (editors + template variables)

  async findDataSources(): Promise<Option[]> {
    const data = await this.request<any>('/api/v2/datasources', 'GET');
    const list = data?.dataSourcesOrigin;
    if (!Array.isArray(list)) {
      throw new Error('Query Error: Could not parse list of data sources');
    }

    const result: Option[] = [];
    for (const ds of list) {
      if (!('dataSourceId' in ds) || !('name' in ds) || !('dataOrigin' in ds)) {
        throw new Error('Query Error: Unknown/Invalid format');
      }
      // Hide data sources where neither origin (Data Storage / Service Engine) is available,
      // unless the datasource is configured to show offline ones.
      const origins = ds.dataOrigin as Array<{ type: string; state: string }>;
      if (!this.showOfflineDatasources && !origins.some((o) => o.state === 'Available')) {
        continue;
      }
      result.push({ label: ds.name, value: ds.dataSourceId });
    }
    return result.sort(byLabel);
  }

  async findArchives(datasourceId: string | undefined, origin: DataOrigin = DataOrigin.DataStorage): Promise<Option[]> {
    if (!datasourceId) {
      return [];
    }
    const id = getTemplateSrv().replace(datasourceId);

    let data: any;
    try {
      data = await this.request<any>(`/api/v2/datasources/${id}/archives`, 'GET');
    } catch {
      return []; // as upstream: an unknown/unreachable datasource just has no archives
    }
    if (!Array.isArray(data?.archives)) {
      throw new Error('Query Error: Could not parse list of archives');
    }

    const required =
      origin === DataOrigin.DataStorageWithServiceEngineFill
        ? [DataOrigin.DataStorage, DataOrigin.ServiceEngine]
        : [origin];
    const archives: Option[] = [];
    const extract = (list: any[], aggregated: boolean) => {
      for (const arch of list) {
        if (!('identification' in arch) || !('name' in arch)) {
          throw new Error('Query Error: Unknown/Invalid format');
        }
        // only list the archive if it exists in the selected data origin(s)
        const available = (arch.dataOrigin as string[] | undefined) ?? [];
        if (required.every((o) => available.includes(o))) {
          archives.push({ label: (aggregated ? '- aggregated - ' : '') + arch.name, value: arch.identification });
        }
        if (Array.isArray(arch.aggregatedArchives)) {
          extract(arch.aggregatedArchives, true);
        }
      }
    };
    extract(data.archives, false);

    // sort by name, ignoring the "aggregated" prefix
    const bare = (label: string) => label.replace(/- aggregated - /, '');
    return archives.sort((a, b) => (bare(a.label) > bare(b.label) ? 1 : -1));
  }

  async findVariablesForArchive(datasourceId: string | undefined, archiveId: string | undefined): Promise<Option[]> {
    if (!datasourceId || !archiveId) {
      return [];
    }
    const templateSrv = getTemplateSrv();
    const path = `/api/v2/datasources/${templateSrv.replace(datasourceId)}/archives/${templateSrv.replace(archiveId)}`;
    const data = await this.request<any>(path, 'GET');
    if (!Array.isArray(data?.variables)) {
      throw new Error('Query Error: Could not parse list of variables');
    }
    return data.variables
      .map((item: any): Option => ({ label: item.variableName, value: item.variableName }))
      .sort(byLabel);
  }

  /** Variables of a datasource; `nameFilter` is applied on the server (see toNamePattern). */
  async findVariables(datasourceId: string | undefined, nameFilter?: string): Promise<Option[]> {
    if (!datasourceId) {
      return [];
    }
    const id = getTemplateSrv().replace(datasourceId);
    const body = { fields: ['name'], nameFilter: { variableNames: [toNamePattern(nameFilter)] } };
    const data = await this.request<any>(`/api/v1/datasources/${id}/variables/query`, 'POST', body);
    if (!Array.isArray(data?.variables)) {
      throw new Error('Query Error: Could not parse list of variables');
    }
    return data.variables.map((v: any): Option => ({ label: v.name, value: v.name })).sort(byLabel);
  }

  // ---------------------------------------------------------------- Template variables

  async metricFindQuery(query: TemplateVariableQuery): Promise<MetricFindValue[]> {
    let regex = /(?:)/;
    try {
      regex = new RegExp(query.regexString ?? '', 'i');
    } catch {
      console.error(query.regexString + ' has invalid regex pattern. Ignore regex filter.');
    }

    let options: Option[] = [];
    switch (query.queryType) {
      case TemplateVariableQueryType.Datasources:
        options = await this.findDataSources();
        break;
      case TemplateVariableQueryType.ArchivesForDatasource:
        options = await this.findArchives(query.datasourceId);
        break;
      case TemplateVariableQueryType.VariablesForArchive:
        options = await this.findVariablesForArchive(query.datasourceId, query.archiveId);
        break;
      case TemplateVariableQueryType.VariablesForDatasource:
        options = await this.findVariables(query.datasourceId);
        break;
    }
    return options.filter((o) => regex.test(o.label)).map((o) => ({ text: o.label, value: o.value }));
  }

  // ---------------------------------------------------------------- Health check

  async testDatasource(): Promise<TestDataSourceResponse> {
    try {
      await this.rawRequest('/', 'GET');
      return { status: 'success', message: 'Connection test successful' };
    } catch (err) {
      return { status: 'error', message: 'Error: ' + toErrorMessage(err) };
    }
  }
}
