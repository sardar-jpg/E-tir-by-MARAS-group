// Global TypeScript declarations for e-tir Gateway

export interface Client {
  id: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  notes?: string;
  customerUserId?: string;   // linked Supabase auth user for customer portal access
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'admin' | 'driver';

export type Language = 'en' | 'tr' | 'ar';

export type ShipmentStatus =
  // ── Universal ──────────────────────────────
  | 'Loaded'
  | 'Dispatched'
  | 'Customs Clearance'
  | 'Customs Pending'
  | 'Arrived'
  | 'Detained'
  // ── Road-specific ───────────────────────────
  | 'In Transit'
  | 'Border Crossing'
  // ── Sea-specific ────────────────────────────
  | 'Booked'
  | 'At Port of Loading'
  | 'Vessel Departed'
  | 'At Sea'
  | 'At Port of Discharge'
  | 'Port Customs'
  // ── Air-specific ────────────────────────────
  | 'Awaiting Flight'
  | 'In Flight'
  | 'Arrived at Hub';

export type ShipmentType = 'Road' | 'Air' | 'Sea';

export type TruckClass =
  | 'Refrigerated'
  | 'Flatbed'
  | 'Box Truck'
  | 'Tanker'
  | 'Container';

export interface Driver {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  plateNumber: string;
  truckClass: TruckClass;
  emailVerified: boolean;
  status: 'Active' | 'Idle' | 'Offline';
  avatarInitials: string;
}

export interface Checkpoint {
  id: string;
  name: string;
  location: string;
  status: 'Cleared' | 'Pending' | 'Current' | 'Upcoming';
  timestamp?: string;
}

export interface ContainerEntry {
  container_number: string;
  seal_number?: string;
  size?: string;       // e.g. '20ft', '40ft', '40ft HC'
  type?: string;       // e.g. 'Dry', 'Reefer', 'Open Top'
  weight?: string;
}

export interface AdditionalDriver {
  driver_id?: string;
  driver_name: string;
  plate_number: string;
  truck_class?: string;
}

export interface Shipment {
  id: string;
  tirNumber: string;
  token: string;
  driverId: string;
  driverName: string;
  plateNumber: string;
  origin: string;
  destination: string;
  cargoDescription: string;
  cargoValue: string;
  weight: string;
  status: ShipmentStatus;
  checkpoints: Checkpoint[];
  estimatedArrival: string;
  agreedPrice?: string;
  priceAccepted?: boolean;
  priceAcceptedAt?: string;
  notes?: string;
  shipmentType: ShipmentType;
  // ── Air-specific ─────────────────────────────
  airlineCarrier?: string;
  flightNumber?: string;
  mawbNumber?: string;
  hawbNumber?: string;
  airportOfOrigin?: string;
  airportOfDestination?: string;
  boardingTerminal?: string;
  // ── Sea-specific ─────────────────────────────
  vesselName?: string;
  voyageNumber?: string;
  bolNumber?: string;
  containerNumber?: string;   // legacy single container
  containers?: ContainerEntry[];  // multi-container (sea)
  portOfLoading?: string;
  portOfDischarge?: string;
  shippingLine?: string;
  incoterms?: string;
  additionalDrivers?: AdditionalDriver[];  // multi-truck (road)
  // ── Client ───────────────────────────────────
  clientId?: string;
  clientName?: string;
  createdAt: string;
  updatedAt: string;
  lat?: number;
  lng?: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  content: string;
  timestamp: string;
  read: boolean;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'document';
}

export interface ChatThread {
  id: string;
  driverId: string;
  driverName: string;
  driverPlate: string;
  shipmentId?: string;          // set for order-specific threads
  messages: ChatMessage[];
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  displayName: string;  // resolved in AuthContext: admin = 'MARAS Dispatch', driver = full_name
  emailVerified: boolean;
  driverId?: string;
}
