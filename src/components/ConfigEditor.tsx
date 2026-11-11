import React from 'react';
import { DataSourceHttpSettings, InlineField, InlineSwitch, Input } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { DEFAULT_SERVICE_ENGINE_FILL_LOOKBACK_HOURS, SGApiDataSourceOptions } from '../types';

type Props = DataSourcePluginOptionsEditorProps<SGApiDataSourceOptions>;

export function ConfigEditor(props: Props) {
  const { options, onOptionsChange } = props;

  const onShowOfflineChange = (event: React.FormEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...options.jsonData, showOfflineDatasources: event.currentTarget.checked },
    });
  };

  const onLookbackChange = (event: React.FormEvent<HTMLInputElement>) => {
    const hours = parseFloat(event.currentTarget.value);
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        serviceEngineFillLookbackHours: Number.isFinite(hours) && hours > 0 ? hours : undefined,
      },
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
      <InlineField
        label="Service Engine fill look-back (h)"
        labelWidth={28}
        tooltip="Origin 'Data Storage + SE fill': the most the Service Engine is asked for, counted back from the end of the time range. Keeps queries on the plant Service Engine small."
      >
        <Input
          id="config-editor-se-fill-lookback"
          type="number"
          min={1}
          width={12}
          placeholder={String(DEFAULT_SERVICE_ENGINE_FILL_LOOKBACK_HOURS)}
          value={options.jsonData.serviceEngineFillLookbackHours ?? ''}
          onChange={onLookbackChange}
        />
      </InlineField>
    </>
  );
}
