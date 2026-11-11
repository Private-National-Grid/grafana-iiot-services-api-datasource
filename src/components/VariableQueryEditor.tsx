import React, { Component } from 'react';
import { AsyncSelect, InlineField, InlineFieldRow, Input, Select } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';

import { DataSource } from '../datasource';
import { defaultVariableQuery, TemplateVariableQuery, TemplateVariableQueryType, withDefaults } from '../types';

const LABEL_WIDTH = 16;

interface Props {
  query: TemplateVariableQuery;
  onChange: (query: TemplateVariableQuery, definition: string) => void;
  datasource: DataSource;
}

type State = {
  datasourceOptions: Array<SelectableValue<string>>;
  archiveOptions: Array<SelectableValue<string>>;
};

const QUERY_TYPES: Array<SelectableValue<TemplateVariableQueryType>> = [
  { label: 'Datasources', value: TemplateVariableQueryType.Datasources },
  { label: 'Archives for datasource', value: TemplateVariableQueryType.ArchivesForDatasource },
  { label: 'Variables for datasource', value: TemplateVariableQueryType.VariablesForDatasource },
  { label: 'Variables for archive', value: TemplateVariableQueryType.VariablesForArchive },
];

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export class VariableQueryEditor extends Component<Props, State> {
  state: State = { datasourceOptions: [], archiveOptions: [] };

  private get query(): TemplateVariableQuery {
    return withDefaults(this.props.query, defaultVariableQuery);
  }

  private definition(q: TemplateVariableQuery): string {
    const ds = this.state.datasourceOptions.find((o) => o.value === q.datasourceId)?.label;
    const archive = this.state.archiveOptions.find((o) => o.value === q.archiveId)?.label;
    switch (q.queryType) {
      case TemplateVariableQueryType.ArchivesForDatasource:
        return 'Archives for the IIoT Services Datasource ' + ds;
      case TemplateVariableQueryType.VariablesForDatasource:
        return 'Variables for the IIoT Services Datasource ' + ds;
      case TemplateVariableQueryType.VariablesForArchive:
        return 'Variables for archive ' + archive + ' of the IIoT Services Datasource ' + ds;
      default:
        return 'IIoT Services Datasources';
    }
  }

  private change(patch: Partial<TemplateVariableQuery>) {
    const next = { ...this.query, ...patch };
    this.props.onChange(next, this.definition(next));
  }

  loadDatasources = async (): Promise<Array<SelectableValue<string>>> => {
    const options = await this.props.datasource.findDataSources();
    this.setState({ datasourceOptions: options });
    return options;
  };

  loadArchives = async (): Promise<Array<SelectableValue<string>>> => {
    const options = await this.props.datasource.findArchives(this.query.datasourceId);
    this.setState({ archiveOptions: options });
    return options;
  };

  render() {
    const query = this.query;
    const { datasourceOptions, archiveOptions } = this.state;
    const regexValid = isValidRegex(query.regexString);

    return (
      <>
        <InlineFieldRow>
          <InlineField label="Query type" labelWidth={LABEL_WIDTH}>
            <Select
              width={32}
              options={QUERY_TYPES}
              value={QUERY_TYPES.find((o) => o.value === query.queryType)}
              onChange={(v) => this.change({ queryType: v.value! })}
            />
          </InlineField>
        </InlineFieldRow>

        {query.queryType !== TemplateVariableQueryType.Datasources && (
          <InlineFieldRow>
            <InlineField
              label="Datasource"
              labelWidth={LABEL_WIDTH}
              invalid={!datasourceOptions.find((o) => o.value === query.datasourceId)}
            >
              <AsyncSelect
                key={query.queryType}
                width={40}
                placeholder="Select a datasource..."
                loadOptions={this.loadDatasources}
                defaultOptions
                value={datasourceOptions.find((o) => o.value === query.datasourceId)}
                onChange={(v) => this.change({ datasourceId: v.value! })}
              />
            </InlineField>
          </InlineFieldRow>
        )}

        {query.queryType === TemplateVariableQueryType.VariablesForArchive && (
          <InlineFieldRow>
            <InlineField
              label="Archive"
              labelWidth={LABEL_WIDTH}
              invalid={!archiveOptions.find((o) => o.value === query.archiveId)}
            >
              <AsyncSelect
                key={query.datasourceId}
                width={40}
                placeholder="Select an archive..."
                loadOptions={this.loadArchives}
                defaultOptions
                value={archiveOptions.find((o) => o.value === query.archiveId)}
                onChange={(v) => this.change({ archiveId: v.value! })}
              />
            </InlineField>
          </InlineFieldRow>
        )}

        <InlineFieldRow>
          <InlineField
            label="Filter values"
            labelWidth={LABEL_WIDTH}
            invalid={!regexValid}
            error={regexValid ? undefined : 'Invalid regex pattern'}
            tooltip="Case-insensitive regular expression applied to the returned names"
          >
            <Input
              width={40}
              placeholder="Apply regex filter to values..."
              value={query.regexString}
              onChange={(e) => this.change({ regexString: e.currentTarget.value })}
            />
          </InlineField>
        </InlineFieldRow>
      </>
    );
  }
}
