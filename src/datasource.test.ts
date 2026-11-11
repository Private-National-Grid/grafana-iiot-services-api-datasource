import { DataSourceInstanceSettings, dateTime, DataQueryRequest } from '@grafana/data';
import { of, throwError } from 'rxjs';

import {
  DataSource,
  expandTemplateVariables,
  matchesNamePattern,
  toErrorMessage,
  toNamePattern,
  toNumber,
  toTime,
} from './datasource';
import {
  DataOrigin,
  DataSourceQuery,
  DataSourceQueryType,
  SGApiDataSourceOptions,
  TemplateVariableQueryType,
  withDefaults,
} from './types';

const fetchMock = jest.fn();
const replaceMock = jest.fn((target?: string) => target ?? '');

// Fully mocked: loading the real @grafana/runtime in Jest leaves handles open and the run never exits.
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: fetchMock }),
  getTemplateSrv: () => ({ replace: replaceMock, getVariables: () => [] }),
  isFetchError: (e: unknown) => typeof e === 'object' && e !== null && 'status' in e && 'data' in e,
}));

const respond = (data: unknown) => of({ data, status: 200, ok: true });

function makeDataSource(jsonData: SGApiDataSourceOptions = {}) {
  return new DataSource({ url: '/proxy', jsonData } as DataSourceInstanceSettings<SGApiDataSourceOptions>);
}

function request(targets: Array<Partial<DataSourceQuery>>): DataQueryRequest<DataSourceQuery> {
  return {
    targets: targets.map((t, i) => ({ refId: String.fromCharCode(65 + i), ...t })),
    range: { from: dateTime('2026-01-01T00:00:00Z'), to: dateTime('2026-01-02T00:00:00Z') },
    scopedVars: {},
  } as unknown as DataQueryRequest<DataSourceQuery>;
}

beforeEach(() => {
  fetchMock.mockReset();
  replaceMock.mockImplementation((target?: string) => target ?? '');
});

describe('name patterns', () => {
  it('wraps typed text in wildcards', () => {
    expect(toNamePattern('')).toBe('*');
    expect(toNamePattern(undefined)).toBe('*');
    expect(toNamePattern(' INV ')).toBe('*INV*');
    expect(toNamePattern('INV*PAC')).toBe('*INV*PAC*');
    expect(toNamePattern('**')).toBe('*');
  });

  it('matches case-insensitively and escapes regex characters', () => {
    expect(matchesNamePattern('Plant.INV01.Pac', '*inv*pac*')).toBe(true);
    expect(matchesNamePattern('Plant.INV01', '*pac*')).toBe(false);
    expect(matchesNamePattern('a.b', '*a.b*')).toBe(true);
    expect(matchesNamePattern('axb', '*a.b*')).toBe(false);
  });
});

describe('value conversion', () => {
  it('converts numbers like the old MutableDataFrame parser', () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber('5.5')).toBe(5.5);
    expect(toNumber(true)).toBe(1);
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber('abc')).toBeNull();
  });

  it('converts timestamps to epoch ms', () => {
    expect(toTime('2026-01-01T00:00:00Z')).toBe(Date.UTC(2026, 0, 1));
    expect(toTime(1234)).toBe(1234);
    expect(toTime('nope')).toBeNull();
    expect(toTime(undefined)).toBeNull();
  });
});

describe('expandTemplateVariables', () => {
  it('splits :json multi-value variables and strips quotes from single values', () => {
    replaceMock.mockImplementation((t?: string) =>
      t === '${multi:json}' ? '["A","B"]' : t === '$single' ? '"C"' : (t ?? '')
    );
    expect(expandTemplateVariables(['${multi:json}', '$single', 'D'])).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('toErrorMessage', () => {
  it('formats API errors', () => {
    expect(toErrorMessage({ status: 401, statusText: 'Unauthorized', data: {} })).toBe(
      'Authorization Error: 401 Unauthorized'
    );
    expect(
      toErrorMessage({ status: 400, data: { errorMessage: 'bad', variableErrors: [{ v: 'x' }] } })
    ).toBe('Bad Request: bad; Details: [{"v":"x"}]');
    expect(toErrorMessage({ status: 500, data: { errorMessage: 'boom' } })).toBe('boom');
    expect(toErrorMessage(new Error('plain'))).toBe('plain');
  });
});

describe('withDefaults', () => {
  it('fills only missing keys and does not mutate the input', () => {
    const input = { a: 1, b: undefined } as { a?: number; b?: number; c?: number };
    const result = withDefaults(input, { a: 9, b: 2, c: 3 });
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
    expect(input).toEqual({ a: 1, b: undefined });
  });
});

describe('DataSource.query', () => {
  it('queries archive data and returns one frame per variable', async () => {
    fetchMock.mockReturnValue(
      respond({
        variables: [
          {
            archiveVariable: { variableName: 'INV01.Pac' },
            values: [
              { timestamp: '2026-01-01T00:00:00Z', value: '10' },
              { timestamp: '2026-01-01T00:15:00Z', value: 12.5 },
            ],
          },
        ],
      })
    );

    const res = await makeDataSource().query(
      request([
        {
          datasourceId: 'ds1',
          queryType: DataSourceQueryType.ArchiveData,
          archiveFilter: { origin: DataOrigin.DataStorage, archiveId: 'AR1', variables: ['INV01.Pac'] },
        },
      ])
    );

    const call = fetchMock.mock.calls[0][0];
    expect(call.url).toBe('/proxy/api/v2/datasources/ds1/archives/AR1/query');
    expect(call.method).toBe('POST');
    expect(call.data).toEqual({
      variableFilter: { variableNames: ['INV01.Pac'] },
      timeFilter: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z', type: 'Absolute' },
      origin: 'DataStorage',
    });

    expect(res.data).toHaveLength(1);
    const frame = res.data[0];
    expect(frame.refId).toBe('A');
    expect(frame.fields.map((f: any) => f.name)).toEqual(['INV01.Pac', 'time']);
    expect(frame.fields[0].values).toEqual([10, 12.5]);
    expect(frame.fields[1].values).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1, 0, 15)]);
  });

  it('skips hidden and incomplete queries and does not mutate targets', async () => {
    const targets: Array<Partial<DataSourceQuery>> = [
      { datasourceId: 'ds1', queryType: DataSourceQueryType.ArchiveData }, // no archive
      { datasourceId: 'ds1', queryType: DataSourceQueryType.VariableValues, hide: true },
    ];
    const req = request(targets);
    const before = JSON.stringify(req.targets);
    const res = await makeDataSource().query(req);
    expect(res.data).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(req.targets)).toBe(before);
  });

  it('returns online values as single-row frames', async () => {
    fetchMock.mockReturnValue(
      respond({ variables: [{ name: 'V1', value: '3', lastUpdateTime: '2026-01-01T00:00:00Z' }] })
    );
    const res = await makeDataSource().query(
      request([
        { datasourceId: 'ds1', queryType: DataSourceQueryType.VariableValues, variableFilter: { variables: ['V1'] } },
      ])
    );
    expect(fetchMock.mock.calls[0][0].url).toBe('/proxy/api/v1/datasources/ds1/variables/query');
    expect(res.data[0].fields[0].values).toEqual([3]);
  });

  it('sends alarm filter flags and maps alarm columns', async () => {
    fetchMock.mockReturnValue(
      respond({
        alarms: [{ id: 'a1', variableName: 'V1', value: 0, receivedTime: '2026-01-01T00:00:00Z', username: 'op' }],
      })
    );
    const res = await makeDataSource().query(
      request([
        {
          datasourceId: 'ds1',
          queryType: DataSourceQueryType.Alarms,
          alarmsEventsFilter: { variables: ['*'], onlyActive: true, onlyCleared: false, onlyUnacknowledged: true },
        },
      ])
    );
    const call = fetchMock.mock.calls[0][0];
    expect(call.url).toBe('/proxy/api/v1/datasources/ds1/alarms/query');
    expect(call.data.filterFlags).toEqual(['OnlyActive', 'OnlyUnacknowledged']);

    const frame = res.data[0];
    const field = (name: string) => frame.fields.find((f: any) => f.name === name);
    expect(field('value').values).toEqual([0]); // 0 is kept, not turned into null
    expect(field('acknowledgedBy').values).toEqual(['op']);
    expect(field('clearedTime').values).toEqual([null]);
  });

  it('turns HTTP failures into a readable query error', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 401, statusText: 'Unauthorized', data: {} })));
    await expect(
      makeDataSource().query(
        request([
          { datasourceId: 'ds1', queryType: DataSourceQueryType.VariableValues, variableFilter: { variables: ['*'] } },
        ])
      )
    ).rejects.toThrow('Query Error: Error during requesting data from API. Authorization Error: 401 Unauthorized');
  });
});

describe('DataSource archive query with Service Engine fill', () => {
  const T = (hhmm: string) => `2026-01-01T${hhmm}:00Z`;
  const series = (name: string, samples: Array<[string, number]>) => ({
    archiveVariable: { variableName: name },
    values: samples.map(([timestamp, value]) => ({ timestamp, value })),
  });
  const fillQuery = (variables = ['V1', 'V2']) =>
    request([
      {
        datasourceId: 'ds1',
        queryType: DataSourceQueryType.ArchiveData,
        archiveFilter: { origin: DataOrigin.DataStorageWithServiceEngineFill, archiveId: 'AR1', variables },
      },
    ]);
  const field = (frame: any, i: number) => frame.fields[i].values;

  it('does not ask the Service Engine when Data Storage reaches the range end', async () => {
    fetchMock.mockReturnValueOnce(respond({ variables: [series('V1', [['2026-01-02T00:00:00Z', 1]])] }));
    const res = await makeDataSource().query(fillQuery(['V1']));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].data.origin).toBe('DataStorage');
    expect(field(res.data[0], 0)).toEqual([1]);
    expect(res.data[0].meta).toBeUndefined();
  });

  it('fills only the tail after the newest Data Storage sample', async () => {
    fetchMock
      .mockReturnValueOnce(
        respond({
          variables: [
            series('V1', [
              [T('19:00'), 1],
              [T('20:00'), 2],
            ]),
            series('V2', [[T('18:00'), 5]]), // rarely changes
          ],
        })
      )
      .mockReturnValueOnce(
        respond({
          variables: [
            series('V1', [
              [T('20:00'), 2],
              [T('21:00'), 3],
            ]),
            series('V2', [[T('22:00'), 6]]),
          ],
        })
      );

    const res = await makeDataSource().query(fillQuery());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0].data).toEqual({
      variableFilter: { variableNames: ['V1', 'V2'] },
      timeFilter: { from: '2026-01-01T20:00:00.000Z', to: '2026-01-02T00:00:00.000Z', type: 'Absolute' },
      origin: 'ServiceEngine',
    });
    const [v1, v2] = res.data;
    expect(field(v1, 0)).toEqual([1, 2, 3]); // the 20:00 overlap is not duplicated
    expect(field(v1, 1)).toEqual([Date.parse(T('19:00')), Date.parse(T('20:00')), Date.parse(T('21:00'))]);
    expect(field(v2, 0)).toEqual([5, 6]);
    expect(v1.meta.notices).toEqual([expect.objectContaining({ severity: 'info' })]);
  });

  it('caps the Service Engine window at the configured look-back', async () => {
    fetchMock
      .mockReturnValueOnce(respond({ variables: [series('V1', [])] }))
      .mockReturnValueOnce(
        respond({
          variables: [
            series('V1', [
              [T('22:00'), 7],
              [T('23:00'), 8],
            ]),
          ],
        })
      );

    const res = await makeDataSource({ serviceEngineFillLookbackHours: 2 }).query(fillQuery(['V1']));

    expect(fetchMock.mock.calls[1][0].data.timeFilter.from).toBe('2026-01-01T22:00:00.000Z');
    expect(field(res.data[0], 0)).toEqual([7, 8]); // sample at the cut-off is kept: Data Storage had none
    expect(res.data[0].meta.notices.map((n: any) => n.severity)).toEqual(['warning', 'info']);
  });

  it('returns Data Storage data with a warning when the Service Engine fails', async () => {
    fetchMock
      .mockReturnValueOnce(respond({ variables: [series('V1', [[T('20:00'), 2]])] }))
      .mockReturnValueOnce(throwError(() => ({ status: 503, statusText: 'Service Unavailable', data: {} })));

    const res = await makeDataSource().query(fillQuery(['V1']));

    expect(field(res.data[0], 0)).toEqual([2]);
    expect(res.data[0].meta.notices).toEqual([
      expect.objectContaining({
        severity: 'warning',
        text: expect.stringContaining('Service Engine fill unavailable'),
      }),
    ]);
  });

  it('still fails the panel when Data Storage fails', async () => {
    fetchMock.mockReturnValueOnce(throwError(() => ({ status: 500, statusText: 'Internal Server Error', data: {} })));
    await expect(makeDataSource().query(fillQuery(['V1']))).rejects.toThrow('Query Error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('DataSource lookups', () => {
  it('hides offline datasources unless configured', async () => {
    const payload = {
      dataSourcesOrigin: [
        { dataSourceId: '2', name: 'B', dataOrigin: [{ type: 'DataStorage', state: 'Available' }] },
        { dataSourceId: '1', name: 'A', dataOrigin: [{ type: 'DataStorage', state: 'Unavailable' }] },
      ],
    };
    fetchMock.mockReturnValue(respond(payload));
    expect(await makeDataSource().findDataSources()).toEqual([{ label: 'B', value: '2' }]);
    expect(await makeDataSource({ showOfflineDatasources: true }).findDataSources()).toEqual([
      { label: 'A', value: '1' },
      { label: 'B', value: '2' },
    ]);
  });

  it('lists archives for the origin, including aggregated ones', async () => {
    fetchMock.mockReturnValue(
      respond({
        archives: [
          {
            identification: 'Z',
            name: 'Zeta',
            dataOrigin: ['DataStorage'],
            aggregatedArchives: [{ identification: 'A', name: 'Alpha', dataOrigin: ['DataStorage'] }],
          },
          { identification: 'S', name: 'SE only', dataOrigin: ['ServiceEngine'] },
        ],
      })
    );
    expect(await makeDataSource().findArchives('ds1')).toEqual([
      { label: '- aggregated - Alpha', value: 'A' },
      { label: 'Zeta', value: 'Z' },
    ]);
  });

  it('lists only archives present in both origins for the Service Engine fill', async () => {
    fetchMock.mockReturnValue(
      respond({
        archives: [
          { identification: 'B', name: 'Both', dataOrigin: ['DataStorage', 'ServiceEngine'] },
          { identification: 'D', name: 'DS only', dataOrigin: ['DataStorage'] },
          { identification: 'S', name: 'SE only', dataOrigin: ['ServiceEngine'] },
        ],
      })
    );
    expect(await makeDataSource().findArchives('ds1', DataOrigin.DataStorageWithServiceEngineFill)).toEqual([
      { label: 'Both', value: 'B' },
    ]);
  });

  it('returns no archives when the request fails', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 404, data: {} })));
    expect(await makeDataSource().findArchives('ds1')).toEqual([]);
  });

  it('filters variables on the server', async () => {
    fetchMock.mockReturnValue(respond({ variables: [{ name: 'b' }, { name: 'a' }] }));
    const vars = await makeDataSource().findVariables('ds1', 'INV');
    expect(fetchMock.mock.calls[0][0].data).toEqual({ fields: ['name'], nameFilter: { variableNames: ['*INV*'] } });
    expect(vars.map((v) => v.value)).toEqual(['a', 'b']);
  });

  it('applies the regex in metricFindQuery', async () => {
    fetchMock.mockReturnValue(respond({ variables: [{ name: 'INV01' }, { name: 'MET01' }] }));
    const result = await makeDataSource().metricFindQuery({
      queryType: TemplateVariableQueryType.VariablesForDatasource,
      datasourceId: 'ds1',
      regexString: '^inv',
    });
    expect(result).toEqual([{ text: 'INV01', value: 'INV01' }]);
  });
});

describe('DataSource.testDatasource', () => {
  it('reports success and failure', async () => {
    fetchMock.mockReturnValueOnce(respond({}));
    expect((await makeDataSource().testDatasource()).status).toBe('success');

    fetchMock.mockReturnValueOnce(throwError(() => ({ status: 401, statusText: 'Unauthorized', data: {} })));
    expect(await makeDataSource().testDatasource()).toEqual({
      status: 'error',
      message: 'Error: Authorization Error: 401 Unauthorized',
    });
  });
});
