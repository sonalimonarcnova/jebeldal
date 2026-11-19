import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const seed = readFileSync(new URL('../seed.sql', import.meta.url), 'utf8');
const graphLiteral = seed.match(
  /\$interview_graph\$\s*([\s\S]*?)\s*\$interview_graph\$/u,
)?.[1];

assert.ok(graphLiteral, 'seed contains the versioned interview graph');
const graph = JSON.parse(graphLiteral);

const expectedKeys = [
  'what_happened',
  'involved',
  'trip',
  'weather_road',
  'other_vehicle',
  'other_driver',
  'property_damaged',
  'property_owner',
  'place_type',
  'delivery_work',
  'product_kept',
  'injuries',
  'seatbelt',
  'driver_injury_where',
  'driver_injury_kind',
  'driver_activity',
  'driver_injury_cause',
  'driver_treatment',
  'doctor_clinic',
  'serious_injury',
  'work_status',
  'other_person_hurt',
  'other_person_type',
  'child_seat',
  'their_treatment',
  'truck_damage',
  'drivable',
  'towed_to',
  'cargo',
  'leak_spill',
  'hazmat_details',
  'police',
  'police_report_no',
  'tickets',
  'drug_alcohol_test',
  'video',
  'prevention',
  'witnesses',
];

const expectedConditionSources = [
  'involved has another_vehicle',
  'involved has object',
  'involved has object OR delivery_claim',
  'involved has delivery_claim',
  'injuries in (me, me_and_someone)',
  'driver_treatment = doctor_or_clinic',
  'driver_treatment = er_or_hospital',
  'injuries in (someone_else, me_and_someone)',
  'other_person_type = child',
  'truck_damage != none',
  'drivable = needs_tow',
  'cargo = some_damage OR drivable = needs_tow',
  'leak_spill = yes_hazmat',
  'police in (came, on_the_way)',
  'DOT post-accident test rule = true',
  'injuries != no_one OR involved has object OR involved has delivery_claim',
  'always (shot list depends on answers)',
];

test('seed has the authored 38-node graph in stable order', () => {
  assert.equal(graph.schema_version, 1);
  assert.equal(graph.question_count, 38);
  assert.deepEqual(graph.form_key_map, {
    Auto: 'auto',
    GL: 'general_liability',
    WC: 'workers_comp',
  });
  assert.equal(graph.nodes.length, 38);
  assert.deepEqual(
    graph.nodes.map((node) => node.sequence),
    Array.from({ length: 38 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    graph.nodes.map((node) => node.key),
    expectedKeys,
  );
  assert.equal(new Set(graph.nodes.map((node) => node.key)).size, 38);
  for (const node of graph.nodes) {
    for (const formName of node.forms_source.split(', ')) {
      assert.ok(graph.form_key_map[formName], `${node.key} references known form ${formName}`);
    }
  }
});

test('all 16 question expressions and the photo-screen rule are referenced', () => {
  assert.equal(graph.condition_count, 17);
  assert.equal(graph.conditions.length, 17);
  assert.equal(new Set(graph.conditions.map((condition) => condition.key)).size, 17);
  assert.equal(new Set(graph.conditions.map((condition) => condition.source)).size, 17);
  assert.deepEqual(
    graph.conditions.map((condition) => condition.source),
    expectedConditionSources,
  );

  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const questionConditions = graph.conditions.filter((condition) => !condition.scope);
  const screenConditions = graph.conditions.filter((condition) => condition.scope === 'screen');

  assert.equal(questionConditions.length, 16);
  assert.equal(screenConditions.length, 1);

  for (const condition of questionConditions) {
    assert.ok(condition.node_keys.length > 0, `${condition.key} has node references`);
    for (const key of condition.node_keys) {
      const node = nodeByKey.get(key);
      assert.ok(node, `${condition.key} references known node ${key}`);
      assert.equal(node.condition_key, condition.key);
      assert.equal(node.show_if_source, condition.source);
    }
  }

  for (const node of graph.nodes) {
    if (node.show_if_source === 'always') {
      assert.equal(node.condition_key, null);
      continue;
    }

    const condition = graph.conditions.find(
      (candidate) => candidate.key === node.condition_key,
    );
    assert.ok(condition, `${node.key} references a known condition`);
    assert.ok(condition.node_keys.includes(node.key));
    assert.equal(condition.source, node.show_if_source);
  }

  assert.deepEqual(screenConditions[0], {
    key: 'photos_videos_shot_list_depends_on_answers',
    source: 'always (shot list depends on answers)',
    scope: 'screen',
    target: 'photos_videos',
  });
});

test('workbook ellipses remain unresolved instead of becoming guessed choices', () => {
  const unresolvedNodes = graph.nodes
    .filter((node) => node.unresolved_options?.length)
    .map((node) => node.key);

  assert.deepEqual(unresolvedNodes, ['weather_road', 'prevention']);
  for (const node of graph.nodes) {
    assert.deepEqual(
      node.unresolved_options ?? [],
      node.options.filter((option) => option === '…'),
    );
  }
});

test('default form-set seed synchronizes idempotently while retaining existing metadata', () => {
  assert.match(seed, /on conflict \(form_set_key, version\) do update\s+set definition = public\.form_sets\.definition \|\| excluded\.definition;/iu);
});
