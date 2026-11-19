const aliases = new Map([
  ['another vehicle', 'another_vehicle'],
  ['a building, fence, or object', 'object'],
  ['building, fence, or object', 'object'],
  ['a building fence or object', 'object'],
  ['customer says our delivery caused it', 'delivery_claim'],
  ['delivery claim', 'delivery_claim'],
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

function normalize(value) {
  const text = String(value).trim().toLowerCase();
  return aliases.get(text) ??
    text.replace(/[^a-z0-9]+/gu, '_').replace(/^_|_$/gu, '');
}

function valuesFor(answers, key) {
  const value = answers[key];
  if (Array.isArray(value)) {
    return value.flatMap((item) => Array.isArray(item) ? item : [item]).filter((
      item,
    ) => item != null)
      .map(normalize);
  }
  return value == null ? [] : [normalize(value)];
}

function hasValue(answers, key, ...expected) {
  const actual = valuesFor(answers, key);
  const normalizedExpected = expected.map(normalize);
  return actual.some((value) => normalizedExpected.includes(value));
}

function hasTicket(answers) {
  return hasValue(
    answers,
    'tickets',
    'i_got_a_ticket',
    'other_driver_ticket',
    'both_got_tickets',
    'ticket',
  );
}

function dotPostAccidentTestRequired(answers) {
  const fatality = hasValue(answers, 'fatality', true, 'fatality') ||
    hasValue(answers, 'injuries', 'fatality');
  const qualifyingTreatment = hasValue(
    answers,
    'driver_treatment',
    'doctor_or_clinic',
    'er_or_hospital',
  );
  const towRequired = hasValue(answers, 'drivable', 'needs_tow');
  return fatality ||
    (hasTicket(answers) && (qualifyingTreatment || towRequired));
}

export function evaluateInterviewCondition(condition, answers) {
  if (!condition || condition.scope === 'screen') return false;

  switch (condition.source) {
    case 'always':
      return true;
    case 'involved has another_vehicle':
      return hasValue(answers, 'involved', 'another_vehicle');
    case 'involved has object':
      return hasValue(answers, 'involved', 'object');
    case 'involved has object OR delivery_claim':
      return hasValue(answers, 'involved', 'object', 'delivery_claim');
    case 'involved has delivery_claim':
      return hasValue(answers, 'involved', 'delivery_claim');
    case 'injuries in (me, me_and_someone)':
      return hasValue(answers, 'injuries', 'me', 'me_and_someone');
    case 'driver_treatment = doctor_or_clinic':
      return hasValue(answers, 'driver_treatment', 'doctor_or_clinic');
    case 'driver_treatment = er_or_hospital':
      return hasValue(answers, 'driver_treatment', 'er_or_hospital');
    case 'injuries in (someone_else, me_and_someone)':
      return hasValue(answers, 'injuries', 'someone_else', 'me_and_someone');
    case 'other_person_type = child':
      return hasValue(answers, 'other_person_type', 'child');
    case 'truck_damage != none':
      return valuesFor(answers, 'truck_damage').some((value) =>
        value !== 'none'
      );
    case 'drivable = needs_tow':
      return hasValue(answers, 'drivable', 'needs_tow');
    case 'cargo = some_damage OR drivable = needs_tow':
      return hasValue(answers, 'cargo', 'some_damage') ||
        hasValue(answers, 'drivable', 'needs_tow');
    case 'leak_spill = yes_hazmat':
      return hasValue(answers, 'leak_spill', 'yes_hazmat');
    case 'police in (came, on_the_way)':
      return hasValue(answers, 'police', 'came', 'on_the_way');
    case 'DOT post-accident test rule = true':
      return dotPostAccidentTestRequired(answers);
    case 'injuries != no_one OR involved has object OR involved has delivery_claim':
      return (valuesFor(answers, 'injuries').length > 0 &&
        !hasValue(answers, 'injuries', 'no_one')) ||
        hasValue(answers, 'involved', 'object', 'delivery_claim');
    default:
      return false;
  }
}

export function selectNextQuestion(graph, answers) {
  const nodes = [...graph.nodes].sort((left, right) =>
    left.sequence - right.sequence
  );
  const conditionByKey = new Map(
    graph.conditions.map((condition) => [condition.key, condition]),
  );
  const answeredKeys = new Set(Object.keys(answers));
  const eligible = nodes.filter((node) => {
    if (answeredKeys.has(node.key)) return false;
    if (!node.condition_key) return node.show_if_source === 'always';
    const condition = conditionByKey.get(node.condition_key);
    return evaluateInterviewCondition(condition, answers);
  });
  const selected = eligible[0];
  return {
    selected_question: selected
      ? {
        key: selected.key,
        prompt: selected.prompt,
        ui_type: selected.ui_type,
        options: selected.options ?? [],
        section: selected.section,
        sequence: selected.sequence,
      }
      : null,
    eligible_keys: eligible.map((node) => node.key),
    selection_source: 'deterministic_fallback',
    interview_complete: eligible.length === 0,
  };
}
