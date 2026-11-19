import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  evaluateInterviewCondition,
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
    prompt: 'What got damaged, and how bad?',
    ui_type: 'voice_open',
    options: [],
    section: 'Scene',
    sequence: 7,
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
