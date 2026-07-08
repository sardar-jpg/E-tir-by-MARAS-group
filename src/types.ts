export type Language = 'en' | 'tr' | 'ar';

export type UserRole = 'admin' | 'driver' | 'client';

export type ShipmentStatus =
  | 'New'
  | 'Assigned'
  | 'Accepted'
  | 'Loading'
  | 'Loaded'
  | 'In Transit'
  | 'Border Crossing'
  | 'Customs Clearance'
  | 'Arrived'
  | 'Delivered'
  | 'Closed'
  // Sea statuses
  | 'Booking Confirmed'
  | 'Container Released'
  | 'Loaded on Vessel'
  | 'Vessel Departed'
  | 'Arrived at Port'
  | 'Released'
  | 'Out for Delivery'
  | 'Completed'
  // Air statuses
  | 'Cargo Received'
  | 'Security Check Completed'
  | 'Departed Airport'
  | 'Arrived Airport';

export type Currency = 'USD' | 'IQD' | 'TRY' | 'EUR';

export type DocumentCategory =
  | 'cmr'
  | 'invoice'
  | 'packing_list'
  | 'customs'
  | 'delivery_proof'
  | 'photo'
  | 'other';

export interface ShipmentDocument {
  id: string;
  name: string;
  url: string;
  category: DocumentCategory;
  uploadedBy: string;
  uploadedAt: string;
  isSharedExternally: boolean;
}

export interface LocationUpdate {
  timestamp: string;
  status: ShipmentStatus;
  labelEn: string;
  labelTr: string;
  labelAr: string;
  detailsEn?: string;
  detailsTr?: string;
  detailsAr?: string;
}

export interface Shipment {
  id: string;
  shipmentNumber: string;
  companyName: string; // Admin only
  loadingCountry: string;
  loadingCity: string;
  loadingAddress: string;
  loadingContactNumber: string;
  deliveryCountry: string;
  deliveryCity: string;
  deliveryAddress: string;
  deliveryContactNumber: string;
  cargoDescription: string;
  cargoWeight: number; // in kg
  truckNumber: string;
  assignedDriverId: string;
  assignedDriverName: string;
  agreedAmount: number;
  currency: Currency;
  internalNotes: string; // Admin only
  status: ShipmentStatus;
  documents: ShipmentDocument[];
  timeline: LocationUpdate[];
  createdAt: string;
  updatedAt: string;
  isLinkShared: boolean;
  shareToken: string;
  shareIncludeDocuments: boolean;
  shareIncludePhotos: boolean;
  
  // Scheduling
  loadingDate?: string;

  // Sea & Air properties
  freightType?: 'land' | 'sea' | 'air';
  additionalDrivers?: Array<{ driverId: string; driverName: string; truckNumber: string; agreedAmount?: number }>;
  additionalContainers?: string[];
  // Sea precise
  shippingLine?: string;
  vesselName?: string;
  containerNumber?: string;
  bookingNumber?: string;
  billOfLadingNumber?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  finalDestination?: string;
  etd?: string;
  eta?: string;
  numberOfContainers?: number;
  containerType?: string;
  // Air precise
  airline?: string;
  flightNumber?: string;
  airWaybillNumber?: string;
  airportOfDeparture?: string;
  airportOfArrival?: string;
  grossWeight?: number;
  chargeableWeight?: number;
  numberOfPackages?: number;
  customerEmails?: string[];
  customerNotificationHistory?: Array<{ id: string; timestamp: string; type: string; title: string; message: string; email: string; channel: 'email' | 'sms' }>;
  
  // Custom Broker info for Land Freight
  destinationBrokerId?: string;
  destinationBrokerName?: string;
  destinationBrokerPhone?: string;
  iraqBorderBrokerId?: string;
  iraqBorderBrokerName?: string;
  iraqBorderBrokerPhone?: string;
}

export interface Driver {
  id: string;
  name: string;
  username: string;
  password?: string;
  email?: string;
  truckNumber: string;
  phone: string;
  activeShipmentsCount: number;
  completedShipmentsCount: number;
  truckType?: string;
  latitude?: number;
  longitude?: number;
  lastUpdated?: string;
  avatarUrl?: string;
  status?: "pending" | "approved" | "rejected";
}

export interface Client {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes?: string;
  createdAt: string;
  username?: string;
  password?: string;
  isEmployee?: boolean;
}

export interface Vendor {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  serviceType: string;
  notes?: string;
  createdAt: string;
}

export const TRUCK_TYPES = [
  { id: "reefer", en: "Refrigerated (Reefer)", tr: "Frigorifik (Frigo)", ar: "مبردة (ثلاجة)" },
  { id: "curtainsider", en: "Curtainsider (Tilt)", tr: "Tenteli Dorse", ar: "جوانب ستائر" },
  { id: "flatbed", en: "Flatbed", tr: "Açık Kasa (Sal)", ar: "مسطحة" },
  { id: "lowboy", en: "Lowboy (Heavy Haul)", tr: "Alçak Şasi (Lowbed)", ar: "منخفضة للحمولات الثقيلة" },
  { id: "dryvan", en: "Box / Dry Van", tr: "Kapalı Kasa", ar: "صندوق مغلق" },
  { id: "tanker", en: "Tanker", tr: "Tanker", ar: "ناقلة سوائل / تانكر" }
];

// BUG-03: which audience a chat message belongs to. Driver/admin dispatch
// chat and client/admin customer-service chat are kept in separate
// threads so drivers never see client identity/content and clients never
// see internal driver/admin operational chat. Messages written before this
// field existed have no channel — the server treats those as admin-only
// (see server.ts chat routes) rather than guessing and risking a leak.
//
// 'internal_staff' (PR #34) is a third, admin-only audience for MARAS
// staff to discuss a shipment among themselves — never visible to driver
// or client sessions, and never exposed via the public share proxy (see
// chatVisibility.ts and the chat routes in server.ts).
export type ChatChannel = 'driver_admin' | 'client_admin' | 'internal_staff';

export interface ChatMessage {
  id: string;
  shipmentId: string;
  sender: 'admin' | 'driver' | 'client';
  senderName: string;
  type: 'text' | 'file';
  text?: string;
  fileUrl?: string;
  fileName?: string;
  fileCategory?: DocumentCategory;
  timestamp: string;
  status?: 'sent' | 'seen';
  channel?: ChatChannel;
}

export interface ActivityLog {
  id: string;
  shipmentId: string;
  shipmentNumber: string;
  actionEn: string;
  actionTr: string;
  actionAr: string;
  actor: string;
  timestamp: string;
}

export interface AppNotification {
  id: string;
  shipmentId: string;
  shipmentNumber: string;
  titleEn: string;
  titleTr: string;
  titleAr: string;
  messageEn: string;
  messageTr: string;
  messageAr: string;
  type: 'assignment' | 'acceptance' | 'rejection' | 'status_update' | 'chat' | 'doc_upload' | 'delivery' | 'driver_registration';
  timestamp: string;
  read: boolean;
  // Session id of the user this notification should NOT be shown to (its
  // own sender), e.g. so an admin doesn't get notified of their own chat
  // message. Absent for notification types that don't need self-exclusion.
  excludeUserId?: string;
  // BUG-03: for type 'chat' notifications, which chat audience this came
  // from (see ChatMessage.channel). Used to keep a driver from being
  // notified of a client message (or vice versa) via the notification
  // center/push, not just the chat thread itself. Absent for non-chat
  // notification types.
  channel?: ChatChannel;
}

export interface CostItem {
  id: string;
  costType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  currency: Currency;
  supplierName: string;
  documentUrl?: string;
  documentName?: string;
  internalNotes?: string;
}

export interface CostStatement {
  shipmentId: string;
  shipmentNumber: string;
  companyName: string;
  shipmentType: 'land' | 'sea' | 'air';
  date: string;
  currency: Currency;
  totalCost: number;
  paidAmount: number;
  remainingBalance: number;
  paymentStatus: 'Unpaid' | 'Partial' | 'Paid';
  notes: string;
  items: CostItem[];
  createdAt: string;
  updatedAt: string;
}

