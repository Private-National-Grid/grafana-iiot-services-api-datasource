import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

// ⚠️ The query/variable-query shapes below are persisted in dashboards. Keep them
// backwards compatible: add optional fields only, never rename or remove.

export enum DataSourceQueryType {
  ArchiveData = 'archiveData',
  VariableValues = 'variableValues',
  Alarms = 'alarms',
  Events = 'events',
}

export enum DataOrigin {
  ServiceEngine = 'ServiceEngine',
  DataStorage = 'DataStorage',
  /**
   * Plugin-side mode, never sent to the API: read Data Storage, then fill the tail that has not
   * been forwarded yet from the Service Engine (see DataSource.queryArchiveWithServiceEngineFill).
   */
  DataStorageWithServiceEngineFill = 'DataStorageWithServiceEngineFill',
}

export enum TemplateVariableQueryType {
  Datasources = 'Datasources',
  ArchivesForDatasource = 'ArchivesForDataSource',
  VariablesForArchive = 'VariablesForArchive',
  VariablesForDatasource = 'VariablesForDatasource',
}

export interface AlarmsEventsFilter {
  variables: string[];
  onlyActive: boolean;
  onlyCleared: boolean;
  onlyUnacknowledged: boolean;
}

export interface ArchiveFilter {
  origin: DataOrigin;
  archiveId?: string;
  variables: string[];
}

export interface VariableFilter {
  variables: string[];
}

export interface DataSourceQuery extends DataQuery {
  datasourceId: string;
  queryType: DataSourceQueryType;
  alarmsEventsFilter: AlarmsEventsFilter;
  archiveFilter: ArchiveFilter;
  variableFilter: VariableFilter;
}

export const defaultQuery: Partial<DataSourceQuery> = {
  queryType: DataSourceQueryType.ArchiveData,
  alarmsEventsFilter: { variables: ['*'], onlyActive: false, onlyCleared: false, onlyUnacknowledged: false },
  archiveFilter: { origin: DataOrigin.DataStorage, variables: [] },
  variableFilter: { variables: [] },
};

export interface TemplateVariableQuery {
  queryType: TemplateVariableQueryType;
  datasourceId?: string;
  archiveId?: string;
  /** Regex applied (case-insensitive) to the returned labels. */
  regexString: string;
}

export const defaultVariableQuery: Partial<TemplateVariableQuery> = {
  queryType: TemplateVariableQueryType.Datasources,
  regexString: '',
};

export interface SGApiDataSourceOptions extends DataSourceJsonData {
  showOfflineDatasources?: boolean;
  /** Longest window (hours, counted back from the range end) the Service Engine fill may read. */
  serviceEngineFillLookbackHours?: number;
}

export const DEFAULT_SERVICE_ENGINE_FILL_LOOKBACK_HOURS = 24;

/** A label/value pair as returned by the find* lookups. */
export interface Option {
  label: string;
  value: string;
}

/**
 * Fills keys that are missing or undefined in `value` from `defaults`, without mutating
 * either (the shallow semantics of lodash `defaults`, which the original plugin used).
 */
export function withDefaults<T extends object>(value: Partial<T> | undefined, defaults: Partial<T>): T {
  const result: Record<string, unknown> = { ...(value ?? {}) };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (result[key] === undefined) {
      result[key] = fallback;
    }
  }
  return result as T;
}
