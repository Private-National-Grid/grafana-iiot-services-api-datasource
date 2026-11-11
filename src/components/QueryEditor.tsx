import React, { Component } from 'react';
import { AsyncMultiSelect, AsyncSelect, InlineField, InlineFieldRow, InlineSwitch, Select } from '@grafana/ui';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';

import { DataSource, matchesNamePattern, toNamePattern } from '../datasource';
import {
  AlarmsEventsFilter,
  DataOrigin,
  DataSourceQuery,
  DataSourceQueryType,
  defaultQuery,
  Option,
  SGApiDataSourceOptions,
  TemplateVariableQueryType,
  withDefaults,
} from '../types';

/** Wait this long after the last keystroke before asking the server for a filtered list. */
const FILTER_DEBOUNCE_MS = 300;
const LABEL_WIDTH = 16;

type Props = QueryEditorProps<DataSource, DataSourceQuery, SGApiDataSourceOptions>;

type State = {
  datasourceOptions: Array<SelectableValue<string>>;
  archiveOptions: Array<SelectableValue<string>>;
};

const QUERY_TYPES: Array<SelectableValue<DataSourceQueryType>> = [
  { label: 'Archive Data', value: DataSourceQueryType.ArchiveData },
  { label: 'Online Values', value: DataSourceQueryType.VariableValues },
  { label: 'Alarms', value: DataSourceQueryType.Alarms },
  { label: 'Events', value: DataSourceQueryType.Events },
];

const DATA_ORIGINS: Array<SelectableValue<DataOrigin>> = [
  { label: 'Data Storage', value: DataOrigin.DataStorage },
  { label: 'Service Engine', value: DataOrigin.ServiceEngine },
];

/** Names of dashboard query variables of this plugin with the given variable-query type. */
function templateVariableNames(queryType: TemplateVariableQueryType): string[] {
  return getTemplateSrv()
    .getVariables()
    .filter((v: any) => v.type === 'query' && v.query?.queryType === queryType)
    .map((v) => v.name);
}

/** Selected options are built from the query itself, so a filtered option list never drops a selection. */
function toVariableOptions(names: string[]): Array<SelectableValue<string>> {
  return names.map((name) => {
    const templateVar = /^\$\{(.+):json\}$/.exec(name);
    return { label: templateVar ? '$' + templateVar[1] : name, value: name };
  });
}

export class QueryEditor extends Component<Props, State> {
  state: State = { datasourceOptions: [], archiveOptions: [] };

  private filterTimer?: ReturnType<typeof setTimeout>;

  /** The current query with defaults filled in (never mutates props.query). */
  private get query(): DataSourceQuery {
    return withDefaults(this.props.query, defaultQuery);
  }

  componentDidMount() {
    this.props.datasource.findDataSources().then((ds: Option[]) => {
      const vars = templateVariableNames(TemplateVariableQueryType.Datasources).map((n) => ({
        label: '$' + n,
        value: '$' + n,
      }));
      this.setState({ datasourceOptions: [...vars, ...ds] });
    });
  }

  componentWillUnmount() {
    clearTimeout(this.filterTimer);
  }

  private change(patch: Partial<DataSourceQuery>, run = false) {
    this.props.onChange({ ...this.query, ...patch });
    if (run) {
      this.props.onRunQuery();
    }
  }

  /** Runs load() at once for the initial list, or after a typing pause when there is filter text. */
  private debounceTyping<T>(input: string | undefined, load: () => Promise<T>): Promise<T> {
    clearTimeout(this.filterTimer);
    if (!input) {
      return load();
    }
    // Superseded requests are left pending; react-select only uses the latest one.
    return new Promise((resolve) => {
      this.filterTimer = setTimeout(() => load().then(resolve), FILTER_DEBOUNCE_MS);
    });
  }

  loadArchives = async (): Promise<Array<SelectableValue<string>>> => {
    const { datasourceId, archiveFilter } = this.query;
    const archives = await this.props.datasource.findArchives(datasourceId, archiveFilter.origin);
    const vars = templateVariableNames(TemplateVariableQueryType.ArchivesForDatasource).map((n) => ({
      label: '$' + n,
      value: '$' + n,
    }));
    const options = [...vars, ...archives];
    this.setState({ archiveOptions: options });
    return options;
  };

  loadArchiveVariables = (input?: string): Promise<Array<SelectableValue<string>>> =>
    this.debounceTyping(input, async () => {
      const { datasourceId, archiveFilter } = this.query;
      const all = await this.props.datasource.findVariablesForArchive(datasourceId, archiveFilter.archiveId);
      // The archive endpoint has no name filter, so filter the fresh response here.
      const pattern = toNamePattern(input);
      const vars = templateVariableNames(TemplateVariableQueryType.VariablesForArchive).map((n) => ({
        label: '$' + n,
        value: '${' + n + ':json}',
      }));
      return [...vars, ...all.filter((v) => matchesNamePattern(v.label, pattern))];
    });

  loadVariables = (input?: string): Promise<Array<SelectableValue<string>>> =>
    this.debounceTyping(input, async () => {
      const found = await this.props.datasource.findVariables(this.query.datasourceId, input);
      const vars = templateVariableNames(TemplateVariableQueryType.VariablesForDatasource).map((n) => ({
        label: '$' + n,
        value: '${' + n + ':json}',
      }));
      return [{ label: '*', value: '*' }, ...vars, ...found];
    });

  private renderVariablePicker(
    key: string,
    selected: string[],
    load: (input?: string) => Promise<Array<SelectableValue<string>>>,
    onSelect: (names: string[]) => void
  ) {
    return (
      <InlineField label="Variable" labelWidth={LABEL_WIDTH} grow invalid={selected.length === 0}>
        <AsyncMultiSelect
          key={key}
          placeholder="Select variables..."
          loadOptions={load}
          defaultOptions
          filterOption={() => true}
          value={toVariableOptions(selected)}
          onChange={(values) => onSelect(values.map((v) => v.value!))}
        />
      </InlineField>
    );
  }

  private renderAlarmFlag(label: string, flag: keyof Omit<AlarmsEventsFilter, 'variables'>) {
    const filter = this.query.alarmsEventsFilter;
    return (
      <InlineField label={label} labelWidth={LABEL_WIDTH}>
        <InlineSwitch
          value={filter[flag]}
          onChange={() => this.change({ alarmsEventsFilter: { ...filter, [flag]: !filter[flag] } }, true)}
        />
      </InlineField>
    );
  }

  render() {
    const query = this.query;
    const { datasourceOptions, archiveOptions } = this.state;
    const { archiveFilter, alarmsEventsFilter, variableFilter } = query;

    let filter: React.ReactNode = null;
    switch (query.queryType) {
      case DataSourceQueryType.ArchiveData:
        filter = (
          <>
            <InlineFieldRow>
              <InlineField
                label="Archive"
                labelWidth={LABEL_WIDTH}
                invalid={!archiveOptions.find((o) => o.value === archiveFilter.archiveId)}
              >
                <AsyncSelect
                  key={JSON.stringify([query.datasourceId, archiveFilter.origin])}
                  width={40}
                  placeholder="Select an archive..."
                  loadOptions={this.loadArchives}
                  defaultOptions
                  value={archiveOptions.find((o) => o.value === archiveFilter.archiveId)}
                  onChange={(v) => this.change({ archiveFilter: { ...archiveFilter, archiveId: v.value! } })}
                />
              </InlineField>
            </InlineFieldRow>
            <InlineFieldRow>
              {this.renderVariablePicker(
                JSON.stringify([query.datasourceId, archiveFilter.origin, archiveFilter.archiveId]),
                archiveFilter.variables,
                this.loadArchiveVariables,
                (variables) => this.change({ archiveFilter: { ...archiveFilter, variables } }, true)
              )}
            </InlineFieldRow>
          </>
        );
        break;

      case DataSourceQueryType.Alarms:
      case DataSourceQueryType.Events:
        filter = (
          <>
            <InlineFieldRow>
              {this.renderVariablePicker(
                query.queryType,
                alarmsEventsFilter.variables,
                this.loadVariables,
                (variables) => this.change({ alarmsEventsFilter: { ...alarmsEventsFilter, variables } }, true)
              )}
            </InlineFieldRow>
            {query.queryType === DataSourceQueryType.Alarms && (
              <InlineFieldRow>
                {this.renderAlarmFlag('Only active', 'onlyActive')}
                {this.renderAlarmFlag('Only cleared', 'onlyCleared')}
                {this.renderAlarmFlag('Only unacknowledged', 'onlyUnacknowledged')}
              </InlineFieldRow>
            )}
          </>
        );
        break;

      case DataSourceQueryType.VariableValues:
        filter = (
          <InlineFieldRow>
            {this.renderVariablePicker(query.queryType, variableFilter.variables, this.loadVariables, (variables) =>
              this.change({ variableFilter: { ...variableFilter, variables } }, true)
            )}
          </InlineFieldRow>
        );
        break;
    }

    return (
      <>
        <InlineFieldRow>
          <InlineField label="Datasource" labelWidth={LABEL_WIDTH} invalid={!query.datasourceId}>
            <Select
              width={40}
              placeholder="Select a datasource..."
              options={datasourceOptions}
              value={datasourceOptions.find((o) => o.value === query.datasourceId)}
              onChange={(v) => this.change({ datasourceId: v.value! })}
            />
          </InlineField>
        </InlineFieldRow>
        <InlineFieldRow>
          <InlineField label="Query type" labelWidth={LABEL_WIDTH}>
            <Select
              width={24}
              options={QUERY_TYPES}
              value={QUERY_TYPES.find((o) => o.value === query.queryType)}
              onChange={(v) => this.change({ queryType: v.value! }, true)}
            />
          </InlineField>
          {query.queryType === DataSourceQueryType.ArchiveData && (
            <InlineField label="Origin" labelWidth={10}>
              <Select
                width={20}
                options={DATA_ORIGINS}
                value={DATA_ORIGINS.find((o) => o.value === archiveFilter.origin)}
                onChange={(v) => this.change({ archiveFilter: { ...archiveFilter, origin: v.value! } })}
              />
            </InlineField>
          )}
        </InlineFieldRow>
        {filter}
      </>
    );
  }
}
