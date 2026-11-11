import React from 'react';
import { DataSourceHttpSettings, InlineField, InlineSwitch } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { SGApiDataSourceOptions } from '../types';

type Props = DataSourcePluginOptionsEditorProps<SGApiDataSourceOptions>;

export function ConfigEditor(props: Props) {
  const { options, onOptionsChange } = props;

  const onShowOfflineChange = (event: React.FormEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...options.jsonData, showOfflineDatasources: event.currentTarget.checked },
    });
  };

  return (
    <>
      <DataSourceHttpSettings
        defaultUrl="https://localhost:9443/iiot-api"
        dataSourceConfig={options}
        showAccessOptions={true}
        onChange={onOptionsChange}
      />

      <h3 className="page-heading">Misc</h3>
      <InlineField
        label="Show offline datasources"
        labelWidth={28}
        tooltip="Include temporarily offline zenon data sources in the query editor"
      >
        <InlineSwitch
          id="config-editor-show-offline"
          value={options.jsonData.showOfflineDatasources ?? false}
          onChange={onShowOfflineChange}
        />
      </InlineField>
    </>
  );
}
