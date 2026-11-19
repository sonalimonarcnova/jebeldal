import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const LOCAL_SUPABASE_URLS = new Set([
  'http://127.0.0.1:54321',
  'http://localhost:54321',
]);

export function assertLocalSupabaseUrl(url) {
  if (!url) {
    throw new Error(
      'Missing required environment variable: SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL',
    );
  }

  if (!LOCAL_SUPABASE_URLS.has(url)) {
    throw new Error(
      'Refusing non-local Supabase URL. Allowed URLs: http://127.0.0.1:54321 and http://localhost:54321',
    );
  }
}

const ORGANIZATION_ID = '11111111-1111-1111-1111-111111111111';
const DEFAULT_LANGUAGE = 'en';

const accounts = [
  {
    email: 'driver+dev1@jebel.local',
    password: 'DevDriver#101',
    display_name: 'Dev Driver One',
    role: 'driver',
    assigned_vehicle_id: '22222222-2222-2222-2222-222222222221',
  },
  {
    email: 'driver+dev2@jebel.local',
    password: 'DevDriver#102',
    display_name: 'Dev Driver Two',
    role: 'driver',
    assigned_vehicle_id: '22222222-2222-2222-2222-222222222222',
  },
  {
    email: 'manager+dev@jebel.local',
    password: 'DevManager#201',
    display_name: 'Dev Manager',
    role: 'manager',
    assigned_vehicle_id: null,
  },
];

const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function listAuthUsers() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Unable to list auth users (${response.status})`);
  }

  const data = await response.json();
  return data.users ?? [];
}

async function createAuthUser(account) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { display_name: account.display_name },
      app_metadata: { role: account.role },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed creating ${account.email} (${response.status})`);
  }

  return response.json();
}

async function upsertProfile(userId, account) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([
      {
        user_id: userId,
        organization_id: ORGANIZATION_ID,
        role: account.role,
        display_name: account.display_name,
        preferred_language: DEFAULT_LANGUAGE,
        assigned_vehicle_id: account.assigned_vehicle_id,
      },
    ]),
  });

  if (!response.ok) {
    throw new Error(`Failed upserting profile for ${account.email} (${response.status})`);
  }

  return response.json();
}

async function main() {
  assertLocalSupabaseUrl(SUPABASE_URL);

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
  }

  const authUsers = await listAuthUsers();
  const userByEmail = new Map(authUsers.map((user) => [user.email?.toLowerCase(), user]));

  const seeded = [];
  for (const account of accounts) {
    const existing = userByEmail.get(account.email.toLowerCase());
    const user = existing ?? (await createAuthUser(account));
    await upsertProfile(user.id, account);
    seeded.push({
      email: account.email,
      role: account.role,
      user_id: user.id,
    });
  }

  console.log('Seeded development accounts:');
  for (const account of seeded) {
    console.log(
      `- ${account.role.padEnd(7)} ${account.email.padEnd(28)}`,
    );
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
