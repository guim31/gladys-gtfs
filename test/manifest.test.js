// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, REFRESH_INTERVALS } from '../src/config.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { TRIGGERS } from '../src/service.js';
import { WIDGETS } from '../src/widgets.js';
import { action, create, createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

test('identity: name, image, cover, cloud transport, services category, location', () => {
  assert.equal(manifest.name, 'Transports en commun (GTFS)');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-gtfs:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-gtfs/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['services']);
  // getHouses() (the stops around the home) is a 403 without it.
  assert.equal(manifest.location, true);
});

test('Gladys 5.1.0 at least: widgets, scene triggers and actions, location', () => {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  const [major, minor] = match.slice(1).map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every scene action has a handler, and its outputs are the declared ones', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:').sort(), keysOf(manifest.scene_actions).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: 'Pader' });
  const stop = await create(world, 'Pader');
  const results = {
    get_next_departures: await world.fake.sceneAction('get_next_departures', {
      stop: stop.external_id,
    }),
  };
  for (const entry of manifest.scene_actions) {
    assert.equal(results[entry.key].success, true, entry.key);
    assert.deepEqual(
      Object.keys(results[entry.key].data.outputs).sort(),
      keysOf(entry.outputs).sort(),
      `${entry.key} outputs`,
    );
    // "Continue only if" compares with ===: numbers, never booleans.
    for (const output of entry.outputs) {
      assert.notEqual(output.type, 'boolean', `${entry.key}.${output.key}`);
      const value = results[entry.key].data.outputs[output.key];
      assert.equal(typeof value, output.type, `${entry.key}.${output.key}`);
    }
  }
});

test('the scene triggers fired by the code are declared, with their fields and variables', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const disruption = field(manifest.scene_triggers, TRIGGERS.DISRUPTION);
  assert.deepEqual(optionValues(field(disruption.fields, 'scope')), ['line', 'network']);
});

test('the event data of every trigger carries its declared fields and variables', async (t) => {
  // Shapes built by the service (see test/service.test.js for the firing).
  const world = await createWorld();
  t.after(() => world.app.stop());
  const disruption = {
    scope: 'line',
    network: 'Tisséo',
    line: 'A',
    title: 'x',
    description: 'y',
    url: '',
  };
  const data = { [TRIGGERS.DISRUPTION]: disruption };
  for (const trigger of manifest.scene_triggers) {
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in data[trigger.key], `${trigger.key}: "${key}" is in the event data`);
    }
  }
});

test('every widget has its handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  assert.deepEqual(handlerKeys('widget:').sort(), Object.keys(WIDGETS).sort());
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(
    optionValues(field(manifest.config_schema, 'refresh_interval')),
    REFRESH_INTERVALS,
  );
});

test('section fields are purely presentational, with https links', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare the devices or houses source and no static options', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.ok(dynamic.length >= 3);
  for (const entry of dynamic) {
    assert.ok(['devices', 'houses'].includes(entry.source), entry.key);
    assert.equal(entry.options, undefined, entry.key);
  }
});

test('actions: no secret field, no default (the core applies none to actions)', () => {
  // GladysAssistant/Gladys#3154 and #3155.
  for (const entry of manifest.actions) {
    for (const item of entry.fields ?? []) {
      assert.notEqual(item.type, 'secret', `${entry.key}.${item.key}`);
      assert.equal(item.default, undefined, `${entry.key}.${item.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
