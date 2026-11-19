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

function findScalarFields(definition, key) {
  const matches = [];
  const visit = (nodes, insideGroup = false) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      const isGroup = node.type === 'repeated_group';
      if (!insideGroup && !isGroup && node.key === key) matches.push(node);
      visit(node.fields, insideGroup || isGroup);
      visit(node.sections, insideGroup || isGroup);
    }
  };
  visit(definition?.fields);
  visit(definition?.sections);
  return matches;
}

function definitionConditionMatches(condition, answers) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    return false;
  }
  if (Array.isArray(condition.all)) {
    return condition.all.every((item) => definitionConditionMatches(item, answers));
  }
  if (Array.isArray(condition.any)) {
    return condition.any.some((item) => definitionConditionMatches(item, answers));
  }
  const values = answers[condition.field_key] ?? [];
  if (condition.op === 'exists') {
    return values.some((value) => value !== null && value !== undefined);
  }
  if (condition.op === 'eq') {
    return values.some((value) =>
      JSON.stringify(value) === JSON.stringify(condition.value)
    );
  }
  if (condition.op === 'in') {
    return Array.isArray(condition.values) && values.some((value) =>
      condition.values.some((candidate) =>
        JSON.stringify(value) === JSON.stringify(candidate)
      )
    );
  }
  return false;
}

export function prepareInterviewGraph(graph, pinnedForms, confirmedAnswersByForm = {}) {
  const formKeyMap = graph.form_key_map ?? {};
  const pinnedDefinitions = pinnedForms.filter((form) =>
    typeof form.form_key === 'string' &&
    form.definition &&
    typeof form.definition === 'object'
  );
  const nodes = graph.nodes.map((node) => {
    const sourceFormKeys = typeof node.forms_source === 'string'
      ? node.forms_source.split(', ').map((name) => formKeyMap[name]).filter(Boolean)
      : [];
    const candidates = node.form_key
      ? pinnedDefinitions.filter((form) => form.form_key === node.form_key)
      : pinnedDefinitions.filter((form) => sourceFormKeys.includes(form.form_key));
    const matches = candidates.flatMap((form) => {
      const fields = findScalarFields(form.definition, node.key);
      return fields.length === 1 ? [{ form, field: fields[0] }] : [];
    });
    const match = matches.length === 1 ? matches[0] : null;
    const safetyCritical = node.key === 'injuries';
    const formAnswers = match ? confirmedAnswersByForm[match.form.form_key] ?? {} : {};
    const conditionallyRequired = match?.field.requiredWhen
      ? definitionConditionMatches(match.field.requiredWhen, formAnswers)
      : false;
    const required = safetyCritical || match?.field.required === true || conditionallyRequired;
    const answerStates = match
      ? ['confirmed', 'unknown', 'declined', 'pending_follow_up']
      : [];
    if (
      match &&
      !required &&
      typeof node.quick_reply === 'string' &&
      normalize(node.quick_reply) === 'not_applicable'
    ) {
      answerStates.push('not_applicable');
    }
    return {
      ...node,
      form_key: match?.form.form_key ?? null,
      required,
      answer_states: answerStates,
    };
  });
  return { ...graph, nodes };
}

export function buildInterviewAnswerContext(answerRows) {
  const confirmedAnswers = Object.create(null);
  const confirmedAnswersByForm = Object.create(null);
  const persistedAnswerKeys = new Set();
  for (const answer of answerRows) {
    if (
      !answer ||
      typeof answer.form_key !== 'string' ||
      typeof answer.field_key !== 'string'
    ) {
      continue;
    }
    persistedAnswerKeys.add(JSON.stringify([answer.form_key, answer.field_key]));
    if (answer.answer_state !== 'confirmed') continue;
    (confirmedAnswers[answer.field_key] ??= []).push(answer.value);
    const formAnswers = confirmedAnswersByForm[answer.form_key] ??= Object.create(null);
    (formAnswers[answer.field_key] ??= []).push(answer.value);
  }
  return { confirmedAnswers, confirmedAnswersByForm, persistedAnswerKeys };
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

export function selectNextQuestion(graph, answers, persistedAnswerKeys = null) {
  const nodes = [...graph.nodes].sort((left, right) =>
    left.sequence - right.sequence
  );
  const conditionByKey = new Map(
    graph.conditions.map((condition) => [condition.key, condition]),
  );
  const answeredKeys = new Set(Object.keys(answers));
  const eligible = nodes.filter((node) => {
    if (persistedAnswerKeys instanceof Set) {
      if (
        node.form_key &&
        persistedAnswerKeys.has(JSON.stringify([node.form_key, node.key]))
      ) return false;
    } else if (answeredKeys.has(node.key)) {
      return false;
    }
    if (!node.condition_key) return node.show_if_source === 'always';
    const condition = conditionByKey.get(node.condition_key);
    return evaluateInterviewCondition(condition, answers);
  });
  const selected = eligible[0];
  return {
    selected_question: selected
      ? {
        key: selected.key,
        field_key: selected.key,
        form_key: selected.form_key ?? null,
        prompt: selected.prompt,
        ui_type: selected.ui_type,
        options: selected.options ?? [],
        section: selected.section,
        sequence: selected.sequence,
        required: selected.required === true,
        answer_states: selected.answer_states ?? [],
      }
      : null,
    eligible_keys: eligible.map((node) => node.key),
    selection_source: 'deterministic_fallback',
    interview_complete: eligible.length === 0,
  };
}
