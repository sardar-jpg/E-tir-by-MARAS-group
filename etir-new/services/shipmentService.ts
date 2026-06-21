import { supabase } from './supabaseClient';
import { Shipment, Checkpoint, ShipmentStatus, ContainerEntry, AdditionalDriver } from '@/types';

interface RawShipment {
  id: string;
  tir_number: string;
  token: string;
  driver_id: string | null;
  driver_name: string;
  plate_number: string;
  origin: string;
  destination: string;
  cargo_description: string;
  cargo_value: string;
  weight: string;
  status: string;
  estimated_arrival: string;
  created_at: string;
  updated_at: string;
  lat?: number;
  lng?: number;
  shipment_type?: string;
  checkpoints?: RawCheckpoint[];
  // Air
  airline_carrier?: string | null;
  flight_number?: string | null;
  mawb_number?: string | null;
  hawb_number?: string | null;
  airport_of_origin?: string | null;
  airport_of_destination?: string | null;
  boarding_terminal?: string | null;
  // Sea
  vessel_name?: string | null;
  voyage_number?: string | null;
  bol_number?: string | null;
  container_number?: string | null;
  containers?: ContainerEntry[] | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  shipping_line?: string | null;
  // Multi-truck
  additional_drivers?: AdditionalDriver[] | null;
  // Client
  client_id?: string | null;
  client_name?: string | null;
}

interface RawCheckpoint {
  id: string;
  shipment_id: string;
  name: string;
  location: string;
  status: string;
  sort_order: number;
  timestamp: string | null;
}

function mapCheckpoint(raw: RawCheckpoint): Checkpoint {
  return {
    id: raw.id,
    name: raw.name,
    location: raw.location,
    status: raw.status as Checkpoint['status'],
    timestamp: raw.timestamp ?? undefined,
  };
}

interface RawShipmentExtended extends RawShipment {
  agreed_price?: string | null;
  price_accepted?: boolean;
  price_accepted_at?: string | null;
}

function mapShipment(raw: RawShipmentExtended): Shipment {
  return {
    id: raw.id,
    tirNumber: raw.tir_number,
    token: raw.token,
    driverId: raw.driver_id ?? '',
    driverName: raw.driver_name,
    plateNumber: raw.plate_number,
    origin: raw.origin,
    destination: raw.destination,
    cargoDescription: raw.cargo_description,
    cargoValue: raw.cargo_value,
    weight: raw.weight,
    status: raw.status as ShipmentStatus,
    estimatedArrival: raw.estimated_arrival,
    createdAt: new Date(raw.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    updatedAt: new Date(raw.updated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    lat: raw.lat,
    lng: raw.lng,
    agreedPrice: (raw as RawShipmentExtended).agreed_price ?? undefined,
    priceAccepted: (raw as RawShipmentExtended).price_accepted ?? false,
    priceAcceptedAt: (raw as RawShipmentExtended).price_accepted_at ?? undefined,
    notes: (raw as any).notes ?? undefined,
    shipmentType: ((raw as any).shipment_type as any) ?? 'Road',
    // Air fields
    airlineCarrier: (raw as any).airline_carrier ?? undefined,
    flightNumber: (raw as any).flight_number ?? undefined,
    mawbNumber: (raw as any).mawb_number ?? undefined,
    hawbNumber: (raw as any).hawb_number ?? undefined,
    airportOfOrigin: (raw as any).airport_of_origin ?? undefined,
    airportOfDestination: (raw as any).airport_of_destination ?? undefined,
    boardingTerminal: (raw as any).boarding_terminal ?? undefined,
    // Sea fields
    vesselName: (raw as any).vessel_name ?? undefined,
    voyageNumber: (raw as any).voyage_number ?? undefined,
    bolNumber: (raw as any).bol_number ?? undefined,
    containerNumber: (raw as any).container_number ?? undefined,
    containers: (raw as any).containers ?? [],
    portOfLoading: (raw as any).port_of_loading ?? undefined,
    portOfDischarge: (raw as any).port_of_discharge ?? undefined,
    shippingLine: (raw as any).shipping_line ?? undefined,
    incoterms: (raw as any).incoterms ?? undefined,
    additionalDrivers: (raw as any).additional_drivers ?? [],
    clientId: (raw as any).client_id ?? undefined,
    clientName: (raw as any).client_name ?? undefined,
    checkpoints: (raw.checkpoints ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(mapCheckpoint),
  };
}

/** Fetch all shipments with their checkpoints */
export async function fetchAllShipments(): Promise<{ shipments: Shipment[]; error: string | null }> {
  const { data, error } = await supabase
    .from('shipments')
    .select(`*, checkpoints(*)`)
    .order('created_at', { ascending: false });

  if (error) return { shipments: [], error: error.message };
  return { shipments: (data as RawShipment[]).map(mapShipment), error: null };
}

/** Fetch shipments for a specific driver — includes both primary and additional-driver assignments */
export async function fetchDriverShipments(driverId: string): Promise<{ shipments: Shipment[]; error: string | null }> {
  // Primary driver query
  const { data: primaryData, error: primaryError } = await supabase
    .from('shipments')
    .select(`*, checkpoints(*)`)
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false });

  if (primaryError) return { shipments: [], error: primaryError.message };

  // Additional drivers query — driver appears in additional_drivers JSONB array
  // Uses @> containment: additional_drivers @> '[{"driver_id": "<uuid>"}]'
  const { data: additionalData, error: additionalError } = await supabase
    .from('shipments')
    .select(`*, checkpoints(*)`)
    .contains('additional_drivers', JSON.stringify([{ driver_id: driverId }]))
    .order('created_at', { ascending: false });

  if (additionalError) {
    // Non-fatal — return primary results only if additional query fails
    console.warn('fetchDriverShipments additional_drivers query failed:', additionalError.message);
    return { shipments: (primaryData as RawShipment[]).map(mapShipment), error: null };
  }

  // Merge and deduplicate by id
  const allRaw = [...(primaryData as RawShipment[]), ...(additionalData as RawShipment[])];
  const seen = new Set<string>();
  const deduped = allRaw.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  // Sort by created_at descending
  deduped.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return { shipments: deduped.map(mapShipment), error: null };
}

/** Fetch a single shipment by token (legacy, kept for internal re-fetch after create) */
export async function fetchShipmentByToken(token: string): Promise<{ shipment: Shipment | null; error: string | null }> {
  const { data, error } = await supabase
    .from('shipments')
    .select(`*, checkpoints(*)`)
    .eq('token', token)
    .single();

  if (error) return { shipment: null, error: error.message };
  return { shipment: mapShipment(data as RawShipment), error: null };
}

/** Fetch a single shipment by its UUID id (public tracking) */
export async function fetchShipmentById(id: string): Promise<{ shipment: Shipment | null; error: string | null }> {
  const { data, error } = await supabase
    .from('shipments')
    .select(`*, checkpoints(*)`)
    .eq('id', id)
    .single();

  if (error) return { shipment: null, error: error.message };
  return { shipment: mapShipment(data as RawShipment), error: null };
}

/** Fetch a single shipment by ETR number (public tracking by shipment number) */
export async function fetchShipmentByTirNumber(tirNumber: string): Promise<{ shipment: Shipment | null; error: string | null }> {
  const { data, error } = await supabase
    .from('shipments')
    .select(`*, checkpoints(*)`)
    .ilike('tir_number', tirNumber.trim())
    .maybeSingle();

  if (error) return { shipment: null, error: error.message };
  if (!data) return { shipment: null, error: null };
  return { shipment: mapShipment(data as RawShipment), error: null };
}

/** Update shipment GPS coordinates */
export async function updateShipmentLocation(id: string, lat: number, lng: number): Promise<string | null> {
  const { error } = await supabase
    .from('shipments')
    .update({ lat, lng, updated_at: new Date().toISOString() })
    .eq('id', id);
  return error?.message ?? null;
}

/** Assign a driver to a shipment */
export async function assignDriverToShipment(
  id: string,
  driverId: string | null,
  driverName: string,
  plateNumber: string
): Promise<string | null> {
  const { error } = await supabase
    .from('shipments')
    .update({
      driver_id: driverId || null,
      driver_name: driverName,
      plate_number: plateNumber,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  return error?.message ?? null;
}

/** Update shipment estimated arrival */
export async function updateShipmentETA(id: string, estimatedArrival: string): Promise<string | null> {
  const { error } = await supabase
    .from('shipments')
    .update({ estimated_arrival: estimatedArrival, updated_at: new Date().toISOString() })
    .eq('id', id);
  return error?.message ?? null;
}

/** Update shipment status */
export async function updateShipmentStatus(id: string, status: ShipmentStatus): Promise<string | null> {
  const { error } = await supabase
    .from('shipments')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  return error?.message ?? null;
}

export interface NewCheckpointInput {
  name: string;
  location: string;
}

/** Driver accepts the agreed price on a shipment */
export async function acceptAgreedPrice(id: string): Promise<string | null> {
  const now = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const { error } = await supabase
    .from('shipments')
    .update({ price_accepted: true, price_accepted_at: now, updated_at: new Date().toISOString() })
    .eq('id', id);
  return error?.message ?? null;
}

export interface CreateShipmentInput {
  tirNumber: string;
  origin: string;
  destination: string;
  driverId: string | null;
  driverName: string;
  plateNumber: string;
  cargoDescription: string;
  cargoValue?: string;
  weight: string;
  estimatedArrival: string;
  agreedPrice?: string;
  notes?: string;
  shipmentType?: 'Road' | 'Air' | 'Sea';
  checkpoints: NewCheckpointInput[];
  // Air
  airlineCarrier?: string;
  flightNumber?: string;
  mawbNumber?: string;
  hawbNumber?: string;
  airportOfOrigin?: string;
  airportOfDestination?: string;
  boardingTerminal?: string;
  // Sea
  vesselName?: string;
  voyageNumber?: string;
  bolNumber?: string;
  containerNumber?: string;  // legacy single (kept for compat)
  containers?: ContainerEntry[];  // multi-container list
  portOfLoading?: string;
  portOfDischarge?: string;
  shippingLine?: string;
  incoterms?: string;
  // Sea arrival driver (picks up cargo at destination port)
  arrivalDriverId?: string;
  arrivalDriverName?: string;
  arrivalDriverPlate?: string;
  // Multi-truck (road)
  additionalDrivers?: AdditionalDriver[];
  clientId?: string;
  clientName?: string;
}

/** Generate a unique tracking token */
function generateToken(): string {
  const suffix = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `token-${suffix}`;
}

/** Fetch the next sequential ETR shipment number (ETR-001, ETR-002, …) */
export async function getNextEtrNumber(): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('shipments')
      .select('tir_number')
      .like('tir_number', 'ETR-%')
      .order('tir_number', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return 'ETR-001';

    const lastNum = parseInt((data[0].tir_number as string).replace('ETR-', ''), 10);
    if (isNaN(lastNum)) return 'ETR-001';
    const next = lastNum + 1;
    return `ETR-${String(next).padStart(3, '0')}`;
  } catch {
    return 'ETR-001';
  }
}

/** Create a new shipment with checkpoints */
export async function createShipment(
  input: CreateShipmentInput
): Promise<{ shipment: Shipment | null; error: string | null }> {
  const token = generateToken();

  const { data: shipmentData, error: shipmentError } = await supabase
    .from('shipments')
    .insert({
      tir_number: input.tirNumber,
      token,
      driver_id: input.driverId || null,
      driver_name: input.driverName,
      plate_number: input.plateNumber,
      origin: input.origin,
      destination: input.destination,
      cargo_description: input.cargoDescription,
      cargo_value: input.cargoValue?.trim() || '',
      weight: input.weight,
      status: input.shipmentType === 'Sea' ? 'Booked' : input.shipmentType === 'Air' ? 'Loaded' : 'Loaded',
      shipment_type: (input as any).shipmentType ?? 'Road',
      estimated_arrival: input.estimatedArrival,
      agreed_price: input.agreedPrice?.trim() || null,
      price_accepted: false,
      // Air
      airline_carrier: input.airlineCarrier?.trim() || null,
      flight_number: input.flightNumber?.trim() || null,
      mawb_number: input.mawbNumber?.trim() || null,
      hawb_number: input.hawbNumber?.trim() || null,
      airport_of_origin: input.airportOfOrigin?.trim() || null,
      airport_of_destination: input.airportOfDestination?.trim() || null,
      boarding_terminal: input.boardingTerminal?.trim() || null,
      // Sea
      vessel_name: input.vesselName?.trim() || null,
      voyage_number: input.voyageNumber?.trim() || null,
      bol_number: input.bolNumber?.trim() || null,
      container_number: input.containerNumber?.trim() || null,
      containers: input.containers && input.containers.length > 0 ? input.containers : [],
      additional_drivers: input.additionalDrivers && input.additionalDrivers.length > 0 ? input.additionalDrivers : [],
      port_of_loading: input.portOfLoading?.trim() || null,
      port_of_discharge: input.portOfDischarge?.trim() || null,
      shipping_line: input.shippingLine?.trim() || null,
      incoterms: input.incoterms?.trim() || null,
      // Notes
      notes: input.notes?.trim() || null,
      client_id: input.clientId || null,
      client_name: input.clientName?.trim() || null,
    })
    .select()
    .single();

  if (shipmentError) return { shipment: null, error: shipmentError.message };

  const shipmentId = (shipmentData as { id: string }).id;

  if (input.checkpoints.length > 0) {
    const cpRows = input.checkpoints.map((cp, i) => ({
      shipment_id: shipmentId,
      name: cp.name,
      location: cp.location,
      status: i === 0 ? 'Current' : 'Upcoming',
      sort_order: i + 1,
    }));
    const { error: cpError } = await supabase.from('checkpoints').insert(cpRows);
    if (cpError) console.warn('Checkpoint insert error:', cpError.message);
  }

  // Re-fetch to get full shipment with checkpoints
  const { shipment, error } = await fetchShipmentByToken(token);
  return { shipment, error };
}
