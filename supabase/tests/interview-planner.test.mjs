import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildInterviewAnswerContext,
  evaluateInterviewCondition,
  prepareInterviewGraph,
  selectNextQuestion,
} from '../functions/_shared/interview.mjs';

const seed = readFileSync(new URL('../seed.sql', import.meta.url), 'utf8');
const graphLiteral = seed.match(
  /\$interview_graph\$\s*([\s\S]*?)\s*\$interview_graph\$/u,
)?.[1];
assert.ok(graphLiteral, 'seed contains the versioned interview graph');
const graph = JSON.parse(graphLiteral);
const questionConditions = graph.conditions.filter((condition) =>
  !condition.scope
);

test('all 16 documented question conditions evaluate from current answers', () => {
  const examples = {
    involved_has_another_vehicle: { involved: ['Another vehicle'] },
    involved_has_object: { involved: ['A building, fence, or object'] },
    involved_has_object_or_delivery_claim: { involved: ['delivery_claim'] },
    involved_has_delivery_claim: {
      involved: ['Customer says our delivery caused it'],
    },
    injuries_in_me_or_me_and_someone: { injuries: 'Yes, me' },
    driver_treatment_is_doctor_or_clinic: {
      driver_treatment: 'Doctor or clinic',
    },
    driver_treatment_is_er_or_hospital: { driver_treatment: 'ER or hospital' },
    injuries_in_someone_else_or_me_and_someone: { injuries: 'Someone else' },
    other_person_type_is_child: { other_person_type: 'A child' },
    truck_damage_not_none: { truck_damage: ['Cab L'] },
    drivable_is_needs_tow: { drivable: 'Needs a tow' },
    cargo_some_damage_or_drivable_needs_tow: { cargo: 'Some damage' },
    leak_spill_is_yes_hazmat: { leak_spill: 'Yes, hazmat' },
    police_in_came_or_on_the_way: { police: 'On the way' },
    dot_post_accident_test_rule: {
      tickets: 'I got a ticket',
      driver_treatment: 'Doctor or clinic',
    },
    injuries_not_no_one_or_object_or_delivery_claim: {
      injuries: 'Someone else',
    },
  };

  assert.equal(questionConditions.length, 16);
  for (const condition of questionConditions) {
    assert.equal(
      evaluateInterviewCondition(condition, examples[condition.key]),
      true,
      `${condition.key} matches its documented source expression`,
    );
    assert.equal(
      evaluateInterviewCondition(condition, {}),
      false,
      `${condition.key} is false without supporting answers`,
    );
  }
});

test('screen-scope condition is ignored by question eligibility', () => {
  const screenCondition = graph.conditions.find((condition) =>
    condition.scope === 'screen'
  );
  assert.equal(evaluateInterviewCondition(screenCondition, {}), false);
});

test('DOT test branch requires the documented fatality or citation rule', () => {
  const condition = graph.conditions.find((candidate) =>
    candidate.key === 'dot_post_accident_test_rule'
  );
  assert.equal(
    evaluateInterviewCondition(condition, {
      driver_treatment: 'Doctor or clinic',
    }),
    false,
  );
  assert.equal(
    evaluateInterviewCondition(condition, {
      tickets: 'I got a ticket',
      drivable: 'Needs a tow',
    }),
    true,
  );
  assert.equal(
    evaluateInterviewCondition(condition, { fatality: true }),
    true,
  );
});

test('selection follows graph order, activates branches, and skips confirmed answers', () => {
  const answers = {
    what_happened: 'A low-speed incident at the loading dock',
    involved: ['A building, fence, or object'],
    trip: 'Dispatched load',
    weather_road: ['Clear'],
    injuries: 'No one',
    truck_damage: 'No damage',
    cargo: 'Cargo is fine',
    police: 'No police',
    video: ['No video'],
  };
  const first = selectNextQuestion(graph, answers);
  assert.deepEqual(first.selected_question, {
    key: 'property_damaged',
    field_key: 'property_damaged',
    form_key: null,
    prompt: 'What got damaged, and how bad?',
    ui_type: 'voice_open',
    options: [],
    section: 'Scene',
    sequence: 7,
    required: false,
    answer_states: [],
  });
  assert.ok(first.eligible_keys.includes('property_owner'));
  assert.ok(first.eligible_keys.includes('prevention'));
  assert.equal(first.selection_source, 'deterministic_fallback');
  assert.equal(first.interview_complete, false);

  const afterPropertyDetails = selectNextQuestion(graph, {
    ...answers,
    property_damaged: 'Dock door bent',
  });
  assert.equal(afterPropertyDetails.selected_question.key, 'property_owner');
  assert.ok(!afterPropertyDetails.eligible_keys.includes('property_damaged'));
});

test('confirmed involved selections activate property branches without detail answers', () => {
  const graphSlice = {
    ...graph,
    nodes: graph.nodes.filter((node) =>
      ['property_damaged', 'place_type', 'delivery_work'].includes(node.key)
    ),
  };
  const prepared = prepareInterviewGraph(graphSlice, [
    {
      form_key: 'general_liability',
      activation_status: 'triggered',
      definition: {
        fields: [
          { key: 'property_damaged', type: 'text' },
          { key: 'place_type', type: 'enum' },
          { key: 'delivery_work', type: 'text' },
        ],
      },
    },
  ]);
  const objectSelection = buildInterviewAnswerContext([{
    form_key: 'auto',
    field_key: 'involved',
    value: ['object'],
    answer_state: 'confirmed',
  }]);
  const objectResult = selectNextQuestion(
    prepared,
    objectSelection.confirmedAnswers,
    objectSelection.persistedAnswerKeys,
  );
  assert.equal(objectResult.selected_question.key, 'property_damaged');

  const deliverySelection = buildInterviewAnswerContext([{
    form_key: 'auto',
    field_key: 'involved',
    value: ['delivery_claim'],
    answer_state: 'confirmed',
  }]);
  const deliveryResult = selectNextQuestion(
    prepared,
    deliverySelection.confirmedAnswers,
    deliverySelection.persistedAnswerKeys,
  );
  assert.equal(deliveryResult.selected_question.key, 'place_type');

  for (const answer_state of ['unknown', 'declined', 'pending_follow_up']) {
    const skippedSelection = buildInterviewAnswerContext([{
      form_key: 'auto',
      field_key: 'involved',
      value: ['object', 'delivery_claim'],
      answer_state,
    }]);
    const skippedResult = selectNextQuestion(
      prepared,
      skippedSelection.confirmedAnswers,
      skippedSelection.persistedAnswerKeys,
    );
    assert.equal(skippedResult.selected_question, null, answer_state);
  }
});

test('selection reports completion when no unanswered eligible questions remain', () => {
  const allAnswered = Object.fromEntries(
    graph.nodes.map((node) => [node.key, 'confirmed']),
  );
  const result = selectNextQuestion(graph, allAnswered);
  assert.equal(result.selected_question, null);
  assert.deepEqual(result.eligible_keys, []);
  assert.equal(result.selection_source, 'deterministic_fallback');
  assert.equal(result.interview_complete, true);
});

test('persisted non-confirmed answers are asked but never drive branches', () => {
  const graphSlice = {
    ...graph,
    nodes: graph.nodes.filter((node) =>
      ['involved', 'property_damaged'].includes(node.key)
    ),
  };
  const preparedGraph = prepareInterviewGraph(graphSlice, [
    {
      form_key: 'auto',
      activation_status: 'triggered',
      definition: { fields: [{ key: 'involved', type: 'multi_enum' }] },
    },
    {
      form_key: 'general_liability',
      activation_status: 'triggered',
      definition: { fields: [{ key: 'property_damaged', type: 'text' }] },
    },
  ]);
  for (const answer_state of ['unknown', 'declined', 'not_applicable', 'pending_follow_up']) {
    const context = buildInterviewAnswerContext([{
      form_key: 'auto',
      field_key: 'involved',
      value: ['A building, fence, or object'],
      answer_state,
    }]);
    const result = selectNextQuestion(
      preparedGraph,
      context.confirmedAnswers,
      context.persistedAnswerKeys,
    );

    assert.equal(Object.keys(context.confirmedAnswers).length, 0, answer_state);
    assert.equal(result.selected_question, null, answer_state);
    assert.equal(result.interview_complete, true, answer_state);
    assert.ok(!result.eligible_keys.includes('property_damaged'), answer_state);
  }
});

test('planner resolves an exact pinned form and advertises only safe statuses', () => {
  const node = graph.nodes.find((candidate) => candidate.key === 'property_owner');
  const prepared = prepareInterviewGraph(
    {
      ...graph,
      nodes: [node],
    },
    [{
      form_key: 'general_liability',
      activation_status: 'not_triggered',
      definition: {
        fields: [{ key: 'property_owner', type: 'text', required: false }],
      },
    }],
  );

  assert.equal(prepared.nodes[0].form_key, 'general_liability');
  assert.deepEqual(prepared.nodes[0].answer_states, [
    'confirmed',
    'unknown',
    'declined',
    'pending_follow_up',
    'not_applicable',
  ]);
  const selected = selectNextQuestion({
    nodes: [{ ...prepared.nodes[0], condition_key: null, show_if_source: 'always' }],
    conditions: [],
  }, {});
  assert.equal(selected.selected_question.form_key, 'general_liability');
  assert.equal(selected.selected_question.field_key, 'property_owner');
  assert.ok(selected.selected_question.answer_states.includes('not_applicable'));
  const differentlyPinnedAnswer = selectNextQuestion({
    nodes: [{ ...prepared.nodes[0], condition_key: null, show_if_source: 'always' }],
    conditions: [],
  }, {}, new Set([JSON.stringify(['auto', 'property_owner'])]));
  assert.equal(differentlyPinnedAnswer.selected_question.form_key, 'general_liability');
});

test('conditional requiredness is based on confirmed answers in the pinned form', () => {
  const node = graph.nodes.find((candidate) => candidate.key === 'police_report_no');
  const prepared = prepareInterviewGraph(
    { ...graph, nodes: [node] },
    [{
      form_key: 'auto',
      activation_status: 'triggered',
      definition: {
        fields: [{
          key: 'police_report_no',
          type: 'text',
          requiredWhen: { op: 'eq', field_key: 'police', value: true },
        }],
      },
    }],
    { auto: { police: [true] } },
  );

  assert.equal(prepared.nodes[0].required, true);
});

test('required safety questions do not advertise not-applicable status', () => {
  const node = graph.nodes.find((candidate) => candidate.key === 'injuries');
  const prepared = prepareInterviewGraph(
    {
      ...graph,
      nodes: [node],
    },
    [{
      form_key: 'auto',
      activation_status: 'triggered',
      definition: {
        fields: [{ key: 'injuries', type: 'boolean', required: false }],
      },
    }],
  );

  assert.equal(prepared.nodes[0].required, true);
  assert.ok(!prepared.nodes[0].answer_states.includes('not_applicable'));
});
