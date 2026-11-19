import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const seed = readFileSync(new URL('../seed.sql', import.meta.url), 'utf8');
const graphLiteral = seed.match(
  /\$interview_graph\$\s*([\s\S]*?)\s*\$interview_graph\$/u,
)?.[1];

assert.ok(graphLiteral, 'seed contains the versioned interview graph');
const graph = JSON.parse(graphLiteral);
const formDefinitions = new Map([
  ['auto', 'auto'],
  ['general_liability', 'gl'],
  ['workers_comp', 'wc'],
].map(([formKey, tag]) => {
  const definitionLiteral = seed.match(
    new RegExp(`\\$${tag}\\$\\s*([\\s\\S]*?)\\s*\\$${tag}\\$::jsonb`, 'u'),
  )?.[1];
  assert.ok(definitionLiteral, `seed contains the ${formKey} scalar inventory`);
  return [formKey, JSON.parse(definitionLiteral)];
}));

function fieldsIn(definition) {
  return definition.sections.flatMap((section) =>
    section.fields.filter((field) => field.type !== 'repeated_group')
  );
}

function groupsIn(definition) {
  const groups = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'repeated_group') {
        groups.push(node);
      }
      if (Array.isArray(node.fields)) visit(node.fields);
      if (Array.isArray(node.sections)) visit(node.sections);
    }
  };
  visit(definition.sections);
  return groups;
}

function allFormFields() {
  return [...formDefinitions.entries()].flatMap(([formKey, definition]) =>
    fieldsIn(definition).map((field) => ({ formKey, field }))
  );
}

function normalizedOption(label) {
  const aliases = new Map([
    ['another vehicle', 'another_vehicle'],
    ['a building, fence, or object', 'object'],
    ['customer says our delivery caused it', 'delivery_claim'],
    ['just my truck', 'just_my_truck'],
    ['no one', 'no_one'],
    ['yes, me', 'me'],
    ['someone else', 'someone_else'],
    ['me and someone else', 'me_and_someone'],
    ['doctor or clinic', 'doctor_or_clinic'],
    ['er or hospital', 'er_or_hospital'],
    ['a child', 'child'],
    ['no damage', 'none'],
    ['needs a tow', 'needs_tow'],
    ['some damage', 'some_damage'],
    ['yes, hazmat', 'yes_hazmat'],
    ['yes, they came', 'came'],
    ['on the way', 'on_the_way'],
    ['no tickets', 'no_tickets'],
    ['i got a ticket', 'i_got_a_ticket'],
    ['the other driver got one', 'other_driver_ticket'],
    ['we both did', 'both_got_tickets'],
  ]);
  const normalized = label.trim().toLocaleLowerCase('en');
  return aliases.get(normalized)
    ?? normalized.replace(/[^a-z0-9]+/gu, '_').replace(/^_|_$/gu, '');
}

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

test('Auto, GL, and WC contain the complete, unique scalar inventory', () => {
  assert.deepEqual(
    Object.fromEntries([...formDefinitions].map(([formKey, definition]) => [
      formKey,
      fieldsIn(definition).length,
    ])),
    { auto: 66, general_liability: 46, workers_comp: 46 },
  );
  assert.deepEqual(
    Object.fromEntries([...formDefinitions].map(([formKey, definition]) => [
      formKey,
      fieldsIn(definition).filter((field) =>
        (Array.isArray(field.source) ? field.source : [field.source]).includes('mockup')
      ).length,
    ])),
    { auto: 47, general_liability: 44, workers_comp: 45 },
  );

  for (const [formKey, definition] of formDefinitions) {
    const fields = fieldsIn(definition);
    const keys = fields.map((field) => field.key);
    assert.equal(new Set(keys).size, fields.length, `${formKey} keys are unique`);
    assert.ok(definition.sections.length > 0, `${formKey} has ordered sections`);
    assert.ok(definition.source_catalog.mockup.endsWith('docs/image.png'));
    assert.ok(
      definition.source_catalog.question_bank
        .endsWith('docs/JebelAI_User_Stories (1).xlsx#Question Bank'),
    );
    assert.ok(definition.mvp_assumptions.length > 0);

    for (const section of definition.sections) {
      assert.match(section.key, /^[a-z][a-z0-9_]*$/u);
      assert.ok(section.label);
    }

    for (const field of fields) {
      assert.match(field.key, /^[a-z][a-z0-9_]*$/u);
      assert.ok(['text', 'long_text', 'enum', 'multi_enum'].includes(field.type));
      assert.equal(typeof field.required, 'boolean');
      assert.ok(typeof field.label === 'string' && field.label.trim());
      if (['text', 'long_text'].includes(field.type)) {
        assert.ok(
          Number.isInteger(field.validation?.maxLength) && field.validation.maxLength > 0,
          `${formKey}.${field.key} has a bounded text validation`,
        );
      }
      if (['enum', 'multi_enum'].includes(field.type)) {
        assert.ok(
          Array.isArray(field.options) && field.options.length > 0,
          `${formKey}.${field.key} has authored choice validation`,
        );
      }
      const sources = Array.isArray(field.source) ? field.source : [field.source];
      assert.ok(sources.length > 0);
      for (const source of sources) {
        assert.ok(
          Object.hasOwn(definition.source_catalog, source),
          `${formKey}.${field.key} has a known source`,
        );
      }
      if (field.prefillSource) {
        assert.ok(
          ['profile', 'vehicle', 'organization', 'policy', 'trip', 'incident', 'device']
            .includes(field.prefillSource),
          `${formKey}.${field.key} references an allowed prefill source`,
        );
      }

      if (field.provisional) {
        assert.ok(
          field.mvp_assumption || definition.mvp_assumptions.length,
          `${formKey}.${field.key} explains its provisional metadata`,
        );
      }
      if (field.source === 'mockup') {
        assert.equal(field.provisional, true, `${formKey}.${field.key} is marked provisional`);
        assert.equal(field.required, false, `${formKey}.${field.key} is optional by default`);
      }
      if (field.validation) {
        assert.ok(
          Object.keys(field.validation).every((key) =>
            ['min', 'max', 'minLength', 'maxLength'].includes(key)
          ),
          `${formKey}.${field.key} uses supported validation metadata`,
        );
      }
      if (field.options) {
        assert.ok(sources.includes('question_bank'));
        assert.ok(field.options.length > 0);
        assert.equal(
          new Set(field.options.map((option) => option.value)).size,
          field.options.length,
          `${formKey}.${field.key} option values are unique`,
        );
      }
    }
  }
});

test('every graph node maps to exactly one form field by its stable key', () => {
  const fields = allFormFields();
  const mappedFormKeys = [];
  for (const node of graph.nodes) {
    const matches = fields.filter(({ field }) => field.key === node.key);
    assert.equal(matches.length, 1, `${node.key} has one scalar mapping`);
    mappedFormKeys.push([node.key, matches[0].formKey]);
    assert.equal(
      matches[0].field.question,
      node.prompt,
      `${node.key} retains the authored prompt`,
    );
    if (matches[0].field.options) {
      const expectedLabels = node.options.filter((option) => option !== '…');
      if (node.quick_reply && ['enum', 'multi_enum'].includes(matches[0].field.type)) {
        expectedLabels.push(node.quick_reply);
      }
      assert.deepEqual(
        matches[0].field.options.map((option) => option.label),
        expectedLabels,
        `${node.key} only exposes authored, resolved options`,
      );
      for (const option of matches[0].field.options) {
        assert.equal(
          option.value,
          normalizedOption(option.label),
          `${node.key}.${option.label} has the stable interview value`,
        );
      }
    } else if (node.options.length) {
      assert.equal(node.key, 'cargo', 'only the mixed select-and-voice field uses text fallback');
    }
  }

  const mappingByForm = Object.fromEntries([...formDefinitions.keys()].map((formKey) => [
    formKey,
    mappedFormKeys.filter(([, mappedFormKey]) => mappedFormKey === formKey)
      .map(([nodeKey]) => nodeKey),
  ]));
  assert.deepEqual(mappingByForm, {
    auto: [
      'what_happened', 'involved', 'trip', 'weather_road', 'other_vehicle',
      'other_driver', 'property_damaged', 'delivery_work', 'injuries',
      'seatbelt', 'driver_treatment', 'serious_injury', 'other_person_hurt',
      'other_person_type', 'child_seat', 'their_treatment', 'truck_damage',
      'drivable', 'towed_to', 'cargo', 'leak_spill', 'hazmat_details', 'police',
      'police_report_no', 'tickets', 'drug_alcohol_test', 'video', 'prevention',
      'witnesses',
    ],
    general_liability: ['property_owner', 'place_type', 'product_kept'],
    workers_comp: [
      'driver_injury_where', 'driver_injury_kind', 'driver_activity',
      'driver_injury_cause', 'doctor_clinic', 'work_status',
    ],
  });
  for (const key of [
    'what_happened',
    'property_damaged',
    'delivery_work',
    'injuries',
    'other_vehicle',
    'police',
  ]) {
    assert.ok(
      mappingByForm.auto.includes(key),
      `${key} retains its evaluator-facing Auto key`,
    );
  }

  const provisionalNodes = [
    'other_vehicle',
    'other_driver',
    'property_damaged',
    'delivery_work',
    'property_owner',
    'cargo',
    'other_person_hurt',
    'doctor_clinic',
    'work_status',
    'video',
    'prevention',
    'witnesses',
    'other_person_type',
    'drug_alcohol_test',
  ];
  for (const key of provisionalNodes) {
    const match = fields.find(({ field }) => field.key === key);
    assert.ok(match?.field.provisional && match.field.mvp_assumption, `${key} explains its MVP mapping`);
  }

  const groupedFallbacks = [
    'other_vehicle',
    'other_driver',
    'property_owner',
    'other_person_hurt',
    'cargo',
    'doctor_clinic',
    'witnesses',
  ];
  for (const key of groupedFallbacks) {
    const match = fields.find(({ field }) => field.key === key);
    assert.ok(
      match?.field.mvp_assumption,
      `${key} retains its provisional interview scalar`,
    );
    assert.ok(!match.field.fields, `${key} remains the scalar interview mapping`);
  }

  const expectedGroups = {
    auto: ['additional_vehicles', 'additional_injured_people', 'additional_witnesses'],
    general_liability: ['additional_claimants', 'additional_properties', 'additional_witnesses'],
    workers_comp: ['additional_injuries'],
  };
  let repeatedFieldCount = 0;
  for (const [formKey, definition] of formDefinitions) {
    const groups = groupsIn(definition);
    assert.deepEqual(groups.map((group) => group.key), expectedGroups[formKey]);
    const formFieldKeys = new Set(fieldsIn(definition).map((field) => field.key));
    for (const group of groups) {
      assert.equal(group.required, false, `${formKey}.${group.key} stays optional until added`);
      assert.ok(group.fields.length > 0, `${formKey}.${group.key} has typed child fields`);
      assert.ok(
        group.fields.some((field) => field.required),
        `${formKey}.${group.key} requires an identifying value once added`,
      );
      assert.ok(
        group.fields.every((field) => field.provisional === true),
        `${formKey}.${group.key} children retain provisional provenance`,
      );
      for (const field of group.fields) {
        repeatedFieldCount += 1;
        assert.ok(
          !formFieldKeys.has(field.key),
          `${formKey}.${group.key}.${field.key} has a unique field key`,
        );
        formFieldKeys.add(field.key);
        assert.ok(
          ['text', 'long_text', 'enum', 'multi_enum'].includes(field.type),
          `${formKey}.${group.key}.${field.key} uses a supported type`,
        );
        if (['enum', 'multi_enum'].includes(field.type)) {
          assert.ok(field.options?.length, `${formKey}.${field.key} has explicit options`);
        }
      }
    }
  }
  assert.equal(repeatedFieldCount, 21);

  const derivedLogicNodes = [
    'property_damaged',
    'delivery_work',
    'injuries',
    'other_person_type',
    'drug_alcohol_test',
  ];
  for (const key of derivedLogicNodes) {
    const match = fields.find(({ field }) => field.key === key);
    assert.ok(
      match?.field.provisional && match.field.mvp_assumption,
      `${key} has explicit provisional derived-rule provenance`,
    );
  }
});

test('requiredness preserves submission essentials and seed upserts definitions', () => {
  const requiredKeys = allFormFields()
    .filter(({ field }) => field.required)
    .map(({ formKey, field }) => `${formKey}.${field.key}`)
    .sort();
  assert.deepEqual(requiredKeys, [
    'auto.injuries',
    'auto.involved',
    'auto.police',
    'auto.what_happened',
  ]);
  const photoRule = formDefinitions.get('auto').requiredEvidence[0];
  assert.deepEqual(photoRule.when.any, [
    { op: 'contains_any', field_key: 'involved', values: ['object', 'delivery_claim'] },
    { op: 'in', field_key: 'injuries', values: ['me', 'someone_else', 'me_and_someone'] },
  ]);
  assert.match(seed, /'general_liability',\s*jsonb_build_object\(\s*'op',\s*'contains_any',\s*'field_key',\s*'involved',\s*'values',\s*jsonb_build_array\('object',\s*'delivery_claim'\)/u);
  assert.ok(formDefinitions.get('auto').mvp_assumptions
    .some((assumption) => assumption.includes('confirmed involved selections')));
  assert.match(seed, /on conflict \(form_key, version\) do update\s+set definition = excluded\.definition,\s+status = excluded\.status;/iu);
  assert.match(seed, /'activation_rules'[\s\S]*?'general_liability'[\s\S]*?'workers_comp'/iu);
});

test('screenshot example values are not copied into the seeded scalar definitions', () => {
  const definitions = [...formDefinitions.values()].map((definition) =>
    JSON.stringify(definition)
  ).join('\n');
  for (const sample of [
    'Northwind Freight LLC',
    'Marcus Reyes',
    'CA-4471-2026',
    '512-555-0147',
    'SKLN-221',
    '26-0912-0387',
  ]) {
    assert.ok(!definitions.includes(sample), `does not seed screenshot value ${sample}`);
  }
});
