import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Client } from '@/types';
import {
  fetchAllClients,
  createClient,
  updateClient,
  deleteClient,
  CreateClientInput,
} from '@/services/clientService';
import { supabase } from '@/services/supabaseClient';

interface ClientsContextType {
  clients: Client[];
  loading: boolean;
  refresh: () => Promise<void>;
  addClient: (input: CreateClientInput) => Promise<{ client: Client | null; error: string | null }>;
  editClient: (id: string, input: Partial<CreateClientInput & { customerUserId?: string | null }>) => Promise<string | null>;
  removeClient: (id: string) => Promise<string | null>;
  getById: (id: string) => Client | null;
}

export const ClientsContext = createContext<ClientsContextType | undefined>(undefined);

export function ClientsProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { clients: data } = await fetchAllClients();
    setClients(data);
    setLoading(false);
  }, []);

  // Only load clients once authenticated — the RLS policy requires an admin session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) load();
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        // Only load clients for admin users — customers sign in to the same Supabase instance
        // but don't have access to the clients table. Checking email domain avoids a wasted query.
        const email = session.user.email ?? '';
        const isAdmin = email.endsWith('@marasgroup.com') || email.endsWith('@maras.iq');
        if (isAdmin) load();
      } else if (event === 'SIGNED_OUT') {
        setClients([]);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [load]);

  const addClient = useCallback(async (input: CreateClientInput) => {
    const { client, error } = await createClient(input);
    if (error) return { client: null, error };
    if (client) setClients(prev => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)));
    return { client, error: null };
  }, []);

  const editClient = useCallback(async (id: string, input: Partial<CreateClientInput & { customerUserId?: string | null }>) => {
    const error = await updateClient(id, input);
    if (!error) {
      setClients(prev => prev.map(c => {
        if (c.id !== id) return c;
        const updated = { ...c, ...input };
        // Map customerUserId separately since it's a type union
        if ('customerUserId' in input) updated.customerUserId = input.customerUserId ?? undefined;
        return updated;
      }));
    }
    return error;
  }, []);

  const removeClient = useCallback(async (id: string) => {
    const error = await deleteClient(id);
    if (!error) setClients(prev => prev.filter(c => c.id !== id));
    return error;
  }, []);

  const getById = useCallback(
    (id: string) => clients.find(c => c.id === id) ?? null,
    [clients]
  );

  return (
    <ClientsContext.Provider value={{ clients, loading, refresh: load, addClient, editClient, removeClient, getById }}>
      {children}
    </ClientsContext.Provider>
  );
}
