// FALLBACK question catalog. The primary catalog is built at runtime from the revision's triggered forms
// (form_catalog.ts); this stub is used only for a triggered form whose definition has no usable fields.
// TODO(E1): replace with ../_shared/engine/graph.ts.
// Keys and option values follow docs/sprint-plan.md task E1 and the workbook "Question Bank" sheet.
// Keep this file free of imports so it runs unchanged under Deno, Node (tests) and Metro.

export type CatalogUi = 'voice_open' | 'single' | 'multi' | 'truck_diagram';
export type ExtractType = 'text' | 'enum' | 'enum_list';
/** How the validated value is stored: booleans travel as "true"/"false" options and are converted back. */
export type ValueKind = 'text' | 'enum' | 'multi_enum' | 'boolean';

export type CatalogEntry = {
  /** Unique within a catalog. Runtime/fallback catalogs use "<form_key>.<field_key>". */
  key: string;
  prompt: string;
  ui: CatalogUi;
  extractType: ExtractType;
  description: string;
  options?: string[];
  /**
   * The value is the driver's whole story in their own words, so it is exempt from the
   * value-vs-evidence length check in validate.ts. TODO(E1): carry this flag into graph.ts.
   */
  narrative?: true;
  /** Set on runtime and fallback catalogs (always present after forCatalogForm / buildFormCatalog). */
  formKey?: string;
  fieldKey?: string;
  valueKind?: ValueKind;
  required?: boolean;
  maxLength?: number;
};

/** Stub entries for one form, keyed "<form_key>.<field_key>" like the runtime catalog. */
export function stubCatalogFor(formKey: string): CatalogEntry[] {
  return getCatalog().map((entry) => ({
    ...entry,
    key: `${formKey}.${entry.key}`,
    formKey,
    fieldKey: entry.key,
    valueKind: entry.extractType === 'text' ? 'text' : entry.extractType === 'enum' ? 'enum' : 'multi_enum',
  }));
}

const CATALOG: readonly CatalogEntry[] = [
  {
    key: 'what_happened',
    prompt: 'What happened?',
    ui: 'voice_open',
    extractType: 'text',
    description: "The driver's own account of the incident, in their words.",
    narrative: true,
  },
  {
    key: 'involved',
    prompt: 'What else was involved?',
    ui: 'multi',
    extractType: 'enum_list',
    description:
      'Everything involved besides the truck: another vehicle; a building, fence, pole or other object; a customer claim that the delivery caused damage; or only the truck.',
    options: ['another_vehicle', 'object', 'delivery_claim', 'just_my_truck'],
  },
  {
    key: 'trip',
    prompt: 'What kind of trip were you on?',
    ui: 'single',
    extractType: 'enum',
    description:
      'Purpose of the trip: a dispatched load or delivery, another work task, commuting to or from work, or parked / in the yard.',
    options: ['dispatched_load', 'other_work_task', 'to_from_work', 'parked_or_yard'],
  },
  {
    key: 'weather_road',
    prompt: 'How was the weather and the road?',
    ui: 'multi',
    extractType: 'enum_list',
    description: 'Weather and light conditions at the time: clear, rain, ice or snow, fog, dark.',
    options: ['clear', 'rain', 'ice_snow', 'fog', 'dark'],
  },
  {
    key: 'other_vehicle',
    prompt: 'Tell me about the other vehicle.',
    ui: 'voice_open',
    extractType: 'text',
    description: 'Make, model, colour and plate of the other vehicle, if stated.',
  },
  {
    key: 'other_driver',
    prompt: 'Who was driving the other vehicle?',
    ui: 'voice_open',
    extractType: 'text',
    description: "The other driver's name, phone number and insurance, if stated.",
  },
  {
    key: 'property_damaged',
    prompt: 'What got damaged, and how bad?',
    ui: 'voice_open',
    extractType: 'text',
    description:
      "Third-party property that was damaged and how badly (fences, buildings, poles, gates, other people's goods). " +
      "Never the driver's own truck or trailer — damage to the driver's truck belongs only in truck_damage.",
  },
  {
    key: 'property_owner',
    prompt: 'Who owns it?',
    ui: 'voice_open',
    extractType: 'text',
    description:
      'Owner of the damaged third-party property and a contact, if stated. ' +
      "Never the driver's own company, truck or trailer.",
  },
  {
    key: 'place_type',
    prompt: 'What kind of place was it?',
    ui: 'single',
    extractType: 'enum',
    description: "Type of location: a customer's site, our own yard or terminal, a public road, or a job site.",
    options: ['customer_site', 'our_yard', 'public_road', 'job_site'],
  },
  {
    key: 'injuries',
    prompt: 'Was anyone hurt?',
    ui: 'single',
    extractType: 'enum',
    description:
      'Who was hurt: no one, the driver (me), someone else, or the driver and someone else. Only answer if the driver says so explicitly.',
    options: ['no_one', 'me', 'someone_else', 'me_and_someone'],
  },
  {
    key: 'truck_damage',
    prompt: 'Where is your truck damaged?',
    ui: 'truck_diagram',
    extractType: 'enum_list',
    description:
      "Damaged zones on the driver's own truck (cab left/right, trailer front/mid/rear left/right, rear, front bumper), or no damage.",
    options: [
      'cab_l',
      'cab_r',
      'trailer_front_l',
      'trailer_front_r',
      'trailer_mid_l',
      'trailer_mid_r',
      'trailer_rear_l',
      'trailer_rear_r',
      'rear',
      'front_bumper',
      'no_damage',
    ],
  },
  {
    key: 'drivable',
    prompt: 'Can you still drive the truck?',
    ui: 'single',
    extractType: 'enum',
    description: 'Whether the truck can still be driven or needs a tow.',
    options: ['can_drive', 'needs_tow'],
  },
  {
    key: 'cargo',
    prompt: 'What were you carrying? Is the cargo okay?',
    ui: 'single',
    extractType: 'enum',
    description: 'Cargo condition: fine, some damage, running empty, or not sure.',
    options: ['cargo_fine', 'some_damage', 'running_empty', 'not_sure'],
  },
  {
    key: 'leak_spill',
    prompt: 'Did anything leak or spill?',
    ui: 'single',
    extractType: 'enum',
    description: 'Whether anything leaked or spilled, and whether it was hazmat.',
    options: ['no_leak', 'yes_hazmat', 'yes_not_hazmat', 'not_sure'],
  },
  {
    key: 'police',
    prompt: 'Did the police come?',
    ui: 'single',
    extractType: 'enum',
    description: 'Whether police came to the scene, are on the way, did not come, or the driver is not sure.',
    options: ['came', 'on_the_way', 'no_police', 'not_sure'],
  },
  {
    key: 'police_report_no',
    prompt: 'What is the police report number?',
    ui: 'voice_open',
    extractType: 'text',
    description: 'Police department and report number, exactly as stated.',
  },
  {
    key: 'tickets',
    prompt: 'Did anyone get a ticket?',
    ui: 'single',
    extractType: 'enum',
    description: 'Who received a ticket: no one, the driver (me), the other driver, both, or not sure.',
    options: ['no_tickets', 'me', 'other_driver', 'both', 'not_sure'],
  },
  {
    key: 'witnesses',
    prompt: 'Did anyone see it happen?',
    ui: 'voice_open',
    extractType: 'text',
    description: 'Names and contact details of witnesses, if stated.',
  },
];

export function getCatalog(): CatalogEntry[] {
  return CATALOG.map((entry) => ({ ...entry, options: entry.options ? [...entry.options] : undefined }));
}
