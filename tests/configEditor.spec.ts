import { test, expect } from '@grafana/plugin-e2e';

// Smoke tests: the plugin loads in the target Grafana version, its config editor renders,
// and "Save & test" goes through the datasource proxy. No IIoT Services API is running in
// CI, so the health check is expected to fail with an error alert.

test('renders the config editor', async ({ createDataSourceConfigPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await createDataSourceConfigPage({ type: ds.type });
  await expect(page.getByText('Show offline datasources')).toBeVisible();
});

test('"Save & test" reports an unreachable API as an error', async ({
  createDataSourceConfigPage,
  readProvisionedDataSource,
  selectors,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const configPage = await createDataSourceConfigPage({ type: ds.type });
  // testDatasource() issues GET <proxy url>/
  const healthCheckPath = `${selectors.apis.DataSource.proxy(
    configPage.datasource.uid,
    configPage.datasource.id.toString()
  )}/`;
  await expect(configPage.saveAndTest({ path: healthCheckPath })).not.toBeOK();
  await expect(configPage).toHaveAlert('error');
});
