import { useContext } from 'react';
import { ClientsContext } from '@/contexts/ClientsContext';

export function useClients() {
  const context = useContext(ClientsContext);
  if (!context) throw new Error('useClients must be used within ClientsProvider');
  return { ...context, refreshClients: context.refresh };
}
