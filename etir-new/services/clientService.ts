import { supabase } from './supabaseClient';
import { Client } from '@/types';

interface RawClient {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  notes: string | null;
  customer_user_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapClient(raw: RawClient): Client {
  return {
    id: raw.id,
    name: raw.name,
    company: raw.company ?? undefined,
    email: raw.email ?? undefined,
    phone: raw.phone ?? undefined,
    country: raw.country ?? undefined,
    city: raw.city ?? undefined,
    notes: raw.notes ?? undefined,
    customerUserId: raw.customer_user_id ?? undefined,
    createdAt: new Date(raw.created_at).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    }),
    updatedAt: new Date(raw.updated_at).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    }),
  };
}

export async function fetchAllClients(): Promise<{ clients: Client[]; error: string | null }> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('name', { ascending: true });
  if (error) return { clients: [], error: error.message };
  return { clients: (data as RawClient[]).map(mapClient), error: null };
}

export interface CreateClientInput {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  notes?: string;
}

export async function createClient(
  input: CreateClientInput
): Promise<{ client: Client | null; error: string | null }> {
  const payload = {
    name: input.name.trim(),
    company: input.company?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    country: input.country?.trim() || null,
    city: input.city?.trim() || null,
    notes: input.notes?.trim() || null,
  };

  // Try the atomic insert+select first — this avoids any race condition
  // since it returns exactly the row just inserted, not a heuristic lookup.
  const { data: inserted, error: insertSelectError } = await supabase
    .from('clients')
    .insert(payload)
    .select()
    .single();

  if (!insertSelectError && inserted) {
    return { client: mapClient(inserted as RawClient), error: null };
  }

  // Fallback path: some RLS configurations reject the USING clause on the
  // returned row even though the insert itself succeeds. Retry as a plain
  // insert, then look up the row we just created. This re-fetch is a
  // heuristic (newest row matching name) and is NOT race-free under
  // concurrent creates of clients with the same name — it's only used when
  // the atomic path above is unavailable.
  const { error: insertError } = await supabase.from('clients').insert(payload);
  if (insertError) {
    console.log('[createClient] insert error:', insertError.message, insertError.code);
    return { client: null, error: insertError.message };
  }

  const { data: fetchedRows, error: fetchError } = await supabase
    .from('clients')
    .select('*')
    .eq('name', input.name.trim())
    .order('created_at', { ascending: false })
    .limit(1);
  if (fetchError || !fetchedRows?.length) {
    // Insert succeeded but fetch failed — return a synthetic client so UI stays consistent
    return {
      client: {
        id: 'pending',
        name: input.name.trim(),
        company: input.company,
        email: input.email,
        phone: input.phone,
        country: input.country,
        city: input.city,
        notes: input.notes,
        createdAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        updatedAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      },
      error: null,
    };
  }
  return { client: mapClient(fetchedRows[0] as RawClient), error: null };
}

export async function updateClient(
  id: string,
  input: Partial<CreateClientInput & { customerUserId?: string | null }>
): Promise<string | null> {
  const payload: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name     !== undefined) payload['name']    = input.name.trim();
  if (input.company  !== undefined) payload['company'] = input.company?.trim() || null;
  if (input.email    !== undefined) payload['email']   = input.email?.trim()   || null;
  if (input.phone    !== undefined) payload['phone']   = input.phone?.trim()   || null;
  if (input.country  !== undefined) payload['country'] = input.country?.trim() || null;
  if (input.city     !== undefined) payload['city']    = input.city?.trim()    || null;
  if (input.notes    !== undefined) payload['notes']   = input.notes?.trim()   || null;
  if ('customerUserId' in input)    payload['customer_user_id'] = input.customerUserId ?? null;

  const { error } = await supabase.from('clients').update(payload).eq('id', id);
  return error?.message ?? null;
}

export async function deleteClient(id: string): Promise<string | null> {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  return error?.message ?? null;
}
